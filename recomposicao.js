/* =========================================================================
   Módulo independente: "Promoções à Parte" (Recomposição de estoque)

   Cruza a planilha de recomposição (SKUs promocionados nos próximos ciclos)
   com a MESMA planilha de estoque importada na aba principal, apenas para
   dizer se o item existe no estoque e em que quantidade.

   Este arquivo é autocontido: não altera nem depende de nada do script.js
   (fluxo principal do bd.xlsx). A única ligação é ouvir o mesmo input
   de upload da planilha de estoque.
   ========================================================================= */
(function () {
    'use strict';

    // Nomes aceitos para a planilha de recomposição, na ordem de tentativa.
    // Basta substituir o arquivo na raiz a cada ciclo mantendo um destes nomes.
    const ARQUIVOS_RECOMPOSICAO = [
        'Recomposição de estoque - SKUs promocionados nos próximos ciclos.xlsx',
        'recomposicao.xlsx'
    ];

    const UNIDADES = [
        { codigo: '13706', nome: 'Palmeira dos Índios' },
        { codigo: '13707', nome: 'Penedo' }
    ];

    let itensRecomposicao = [];   // { sku, descricao, acao }
    let linhasCruzadas = [];      // { sku, descricao, acao, quantidades, total, temEstoque }
    let acoesDisponiveis = new Set();
    let estoquePendente = null;   // estoque importado antes da lista terminar de carregar

    // --- Funções Auxiliares ---
    function el(id) {
        return document.getElementById(id);
    }

    function escapar(texto) {
        return String(texto === undefined || texto === null ? '' : texto)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Busca o valor de uma coluna testando variações de nome (igual ao fluxo principal)
    function valorFlexivel(linha, alvos) {
        const chaves = Object.keys(linha);
        for (const alvo of alvos) {
            const encontrada = chaves.find(k => k.trim().toLowerCase() === alvo.trim().toLowerCase());
            if (encontrada !== undefined && linha[encontrada] !== '' && linha[encontrada] !== undefined) {
                return linha[encontrada];
            }
        }
        return undefined;
    }

    function descricaoFlexivel(linha) {
        const chave = Object.keys(linha).find(k => {
            const nome = k.trim().toLowerCase();
            return nome.includes('descri') || nome.includes('nome') || nome === 'description';
        });
        return chave ? linha[chave] : undefined;
    }

    // "53543.0" -> "53543" | "00000000000002 - ETI PORTA JOIAS" -> "2"
    // Mesma normalização usada na aba principal, para os SKUs baterem.
    function normalizarSKU(valor) {
        if (valor === undefined || valor === null || valor === '') return null;
        let texto = String(valor).trim();
        if (!texto) return null;
        if (texto.includes(' - ')) texto = texto.split(' - ')[0].trim();
        const numero = Number(texto);
        return isNaN(numero) ? texto : String(numero);
    }

    // "4,000" -> 4 | "1.234,000" -> 1234
    function parseQuantidade(valor) {
        if (valor === undefined || valor === null || valor === '') return 0;
        if (typeof valor === 'number') return valor;
        let texto = String(valor).trim().replace(/\s/g, '');
        if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
        const numero = parseFloat(texto);
        return isNaN(numero) ? 0 : numero;
    }

    function formatarQuantidade(valor) {
        if (Number.isInteger(valor)) return String(valor);
        return valor.toFixed(3).replace('.', ',');
    }

    // --- 1. Leitura da planilha de recomposição ---

    // A planilha não começa na linha 1 e as colunas variam de posição,
    // então localizamos a linha de cabeçalho procurando a coluna "SKU".
    function extrairItens(workbook) {
        const encontrados = [];

        workbook.SheetNames.forEach(nomeAba => {
            const matriz = XLSX.utils.sheet_to_json(workbook.Sheets[nomeAba], {
                header: 1,
                raw: false,
                defval: ''
            });

            const idxCabecalho = matriz.findIndex(linha =>
                Array.isArray(linha) && linha.some(celula => String(celula).trim().toLowerCase() === 'sku')
            );
            if (idxCabecalho === -1) return;

            const cabecalho = matriz[idxCabecalho].map(c => String(c).trim().toLowerCase());
            const colSku = cabecalho.findIndex(c => c === 'sku' || c === 'código produto' || c === 'codigo produto');
            const colDescricao = cabecalho.findIndex(c => c.includes('descri'));
            const colAcao = cabecalho.findIndex(c => c.includes('ação') || c.includes('acao'));

            for (let i = idxCabecalho + 1; i < matriz.length; i++) {
                const linha = matriz[i];
                if (!Array.isArray(linha)) continue;

                const sku = normalizarSKU(linha[colSku]);
                if (!sku) continue;

                encontrados.push({
                    sku: sku,
                    descricao: colDescricao > -1 ? String(linha[colDescricao] || '').trim() : '',
                    acao: colAcao > -1 ? String(linha[colAcao] || '').trim() : ''
                });
            }
        });

        // SKU repetido em mais de uma ação vira uma linha só, com as ações juntas
        const porSku = new Map();
        encontrados.forEach(item => {
            const existente = porSku.get(item.sku);
            if (!existente) {
                porSku.set(item.sku, item);
                return;
            }
            if (item.acao && !existente.acao.split(' / ').includes(item.acao)) {
                existente.acao = existente.acao ? existente.acao + ' / ' + item.acao : item.acao;
            }
            if (!existente.descricao) existente.descricao = item.descricao;
        });

        return Array.from(porSku.values());
    }

    function carregarPlanilha(indice) {
        indice = indice || 0;
        if (indice >= ARQUIVOS_RECOMPOSICAO.length) {
            const status = el('status-recomp');
            status.textContent = '❌ Planilha de promoções à parte não encontrada na raiz.';
            status.classList.add('status-erro');
            return;
        }

        const arquivo = ARQUIVOS_RECOMPOSICAO[indice];

        fetch('./' + encodeURIComponent(arquivo), { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error('não encontrado');
                return response.arrayBuffer();
            })
            .then(data => {
                const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
                itensRecomposicao = extrairItens(workbook);

                if (itensRecomposicao.length === 0) throw new Error('sem SKUs');

                acoesDisponiveis = new Set(
                    itensRecomposicao.map(i => i.acao).filter(Boolean)
                );
                preencherFiltroAcoes();

                el('status-recomp').textContent =
                    `✅ Lista de promoções à parte carregada (${itensRecomposicao.length} SKUs)`;
                el('tab-count-recomp').textContent = itensRecomposicao.length;

                // Estoque importado antes desta lista ficar pronta
                if (estoquePendente) {
                    cruzarComEstoque(estoquePendente);
                    estoquePendente = null;
                }
            })
            .catch(() => carregarPlanilha(indice + 1));
    }

    function preencherFiltroAcoes() {
        const select = el('recompFiltroAcao');
        if (!select) return;

        select.innerHTML = '<option value="">Todas as Ações</option>';
        Array.from(acoesDisponiveis).sort().forEach(acao => {
            const option = document.createElement('option');
            option.value = acao;
            option.textContent = acao;
            select.appendChild(option);
        });
    }

    // --- 2. Cruzamento com a planilha de estoque ---
    function cruzarComEstoque(estoque) {
        // sku -> { '13706': qtd, '13707': qtd, descricao }
        const saldoPorSku = new Map();

        estoque.forEach(item => {
            const sku = normalizarSKU(valorFlexivel(item, ['Produto', 'Código Produto', 'Codigo Produto']));
            if (!sku) return;

            const unidade = String(valorFlexivel(item, ['Quebra', 'Loja']) || '').trim();
            const saldo = parseQuantidade(valorFlexivel(item, ['Saldo Atual', 'Estoque Final']));

            let registro = saldoPorSku.get(sku);
            if (!registro) {
                registro = { descricao: '' };
                UNIDADES.forEach(u => { registro[u.codigo] = 0; });
                saldoPorSku.set(sku, registro);
            }

            if (Object.prototype.hasOwnProperty.call(registro, unidade)) {
                registro[unidade] += saldo;
            }

            if (!registro.descricao) {
                const bruto = valorFlexivel(item, ['Descricao', 'Descrição']) || descricaoFlexivel(item);
                let texto = bruto ? String(bruto).trim() : '';
                // Formato "00000000000002 - Descrição" vem tudo na coluna Produto
                if (!texto) {
                    const produto = String(valorFlexivel(item, ['Produto']) || '');
                    if (produto.includes(' - ')) texto = produto.split(' - ').slice(1).join(' - ').trim();
                }
                registro.descricao = texto;
            }
        });

        linhasCruzadas = itensRecomposicao.map(item => {
            const registro = saldoPorSku.get(item.sku);
            const quantidades = {};
            let total = 0;

            UNIDADES.forEach(u => {
                const qtd = registro ? registro[u.codigo] : 0;
                quantidades[u.codigo] = qtd;
                total += qtd;
            });

            return {
                sku: item.sku,
                descricao: item.descricao || (registro && registro.descricao) || 'Sem descrição',
                acao: item.acao || 'Sem ação',
                quantidades: quantidades,
                total: total,
                temEstoque: total > 0
            };
        });

        el('recomp-placeholder').classList.add('hidden');
        el('recomp-content').classList.remove('hidden');
        renderizar();
    }

    // --- 3. Filtros e renderização ---
    function obterLinhasFiltradas() {
        const busca = el('recompSearch').value.trim().toLowerCase();
        const acao = el('recompFiltroAcao').value;
        const situacao = el('recompFiltroStatus').value;

        return linhasCruzadas.filter(linha => {
            if (busca && !(`${linha.sku} ${linha.descricao}`.toLowerCase().includes(busca))) return false;
            if (acao && linha.acao !== acao) return false;
            if (situacao === 'com' && !linha.temEstoque) return false;
            if (situacao === 'sem' && linha.temEstoque) return false;
            return true;
        });
    }

    function celulaQuantidade(qtd) {
        return qtd > 0
            ? `<span class="qtd-pill qtd-ok">${formatarQuantidade(qtd)}</span>`
            : `<span class="qtd-pill qtd-zero">0</span>`;
    }

    function renderizar() {
        const corpo = el('recomp-tbody');
        const linhas = obterLinhasFiltradas();

        corpo.innerHTML = linhas.map(linha => `
            <tr class="${linha.temEstoque ? 'linha-tem' : 'linha-nao-tem'}">
                <td class="col-sku">${escapar(linha.sku)}</td>
                <td class="col-desc">${escapar(linha.descricao)}</td>
                <td class="col-acao"><span class="badge-acao">${escapar(linha.acao)}</span></td>
                <td class="col-qtd">${celulaQuantidade(linha.quantidades['13706'])}</td>
                <td class="col-qtd">${celulaQuantidade(linha.quantidades['13707'])}</td>
                <td class="col-qtd"><strong>${formatarQuantidade(linha.total)}</strong></td>
                <td class="col-situacao">${linha.temEstoque
                    ? '<span class="situacao situacao-ok">✅ Tem</span>'
                    : '<span class="situacao situacao-no">❌ Não tem</span>'}</td>
            </tr>
        `).join('');

        el('recomp-msg-vazio').style.display = linhas.length === 0 ? 'block' : 'none';

        // Resumo considera sempre a lista completa, não o filtro
        const comEstoque = linhasCruzadas.filter(l => l.temEstoque).length;
        el('recomp-com').textContent = comEstoque;
        el('recomp-sem').textContent = linhasCruzadas.length - comEstoque;
        el('recomp-total').textContent = linhasCruzadas.length;
        el('tab-count-recomp').textContent = comEstoque;
    }

    // --- 4. Exportação ---
    function exportar() {
        const linhas = obterLinhasFiltradas();

        if (linhas.length === 0) {
            alert('Não há itens visíveis para exportar. Verifique os filtros aplicados.');
            return;
        }

        const dados = linhas.map(linha => ({
            SKU: linha.sku,
            Descricao: linha.descricao,
            'Ação': linha.acao,
            'Palmeira (13706)': linha.quantidades['13706'],
            'Penedo (13707)': linha.quantidades['13707'],
            Total: linha.total,
            'Situação': linha.temEstoque ? 'Tem estoque' : 'Sem estoque'
        }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), 'Promoções à Parte');
        XLSX.writeFile(wb, 'Promocoes_A_Parte.xlsx');
    }

    // --- 5. Abas ---
    function configurarAbas() {
        const botoes = document.querySelectorAll('.tab-btn');

        botoes.forEach(botao => {
            botao.addEventListener('click', () => {
                botoes.forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

                botao.classList.add('active');
                el('panel-' + botao.dataset.tab).classList.add('active');
            });
        });
    }

    // --- Inicialização ---
    window.addEventListener('DOMContentLoaded', () => {
        configurarAbas();
        carregarPlanilha(0);

        el('recompSearch').addEventListener('keyup', renderizar);
        el('recompFiltroAcao').addEventListener('change', renderizar);
        el('recompFiltroStatus').addEventListener('change', renderizar);
        el('btn-export-recomp').addEventListener('click', exportar);

        // Mesmo arquivo de estoque da aba principal, lido de forma independente
        el('upload').addEventListener('change', evt => {
            const arquivo = evt.target.files[0];
            if (!arquivo) return;

            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    const ws = workbook.Sheets[workbook.SheetNames[0]];
                    const estoque = XLSX.utils.sheet_to_json(ws, { raw: false });

                    // A lista de recomposição ainda pode estar carregando
                    if (itensRecomposicao.length === 0) {
                        estoquePendente = estoque;
                        return;
                    }
                    cruzarComEstoque(estoque);
                } catch (err) {
                    const status = el('status-recomp');
                    status.textContent = '❌ Erro ao cruzar a planilha de estoque: ' + err.message;
                    status.classList.add('status-erro');
                }
            };
            reader.readAsArrayBuffer(arquivo);
        });
    });
})();
