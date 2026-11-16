/* =========================================================================
   Módulo independente: "Semana Outlet"

   Cruza a lista da Semana Outlet - Especial Beauty Week (semanaoutlet.xlsx)
   com a MESMA planilha de estoque importada na aba principal, mostrando
   até quando cada item fica no outlet, o desconto com BSO da indústria, o
   limite liberado no +L+B e o saldo por unidade.

   O semanaoutlet.xlsx é a planilha original da lista do franqueado
   ("ciclo-16-_-semana-outlet-...-(lista-franqueado)-*.xlsx"), sem
   alterações — para atualizar, basta substituir o arquivo. Colunas usadas:
   Unidade Negócio (marca: BOT, QDB, EUD, OUI) | Data Início | Data Fim |
   Cód. Item | Descrição Item | Categoria | Subcategoria | BSO Indústria |
   % Desconto (com BSO) | Disponível +L+B

   Linhas repetidas do mesmo SKU com a mesma condição (só muda a data fim,
   ex.: Eudora até 22/11 e até 25/11) viram uma linha só, com o período mais
   longo. Condições diferentes (ex.: item O.U.I listado em BOT sem BSO e em
   OUI com BSO) continuam em linhas separadas.

   Não depende dos outros scripts: ouve o mesmo input de upload da planilha
   de estoque.
   ========================================================================= */
(function () {
    'use strict';

    const ARQUIVO_OUTLET = 'semanaoutlet.xlsx';

    const UNIDADES = [
        { codigo: '13706', nome: 'Palmeira dos Índios' },
        { codigo: '13707', nome: 'Penedo' }
    ];

    // Mesmos nomes de marca da aba Beauty Week
    const NOMES_MARCA = { BOT: 'BOTICARIO', EUD: 'EUDORA', QDB: 'QDB', OUI: 'OUI' };

    const ORDEM_SITUACAO = { ativa: 0, futura: 1, encerrada: 2 };

    const DIA_MS = 24 * 60 * 60 * 1000;

    let itensOutlet = [];        // uma linha por condição (um SKU pode ter mais de uma)
    let linhasCruzadas = [];     // itensOutlet + quantidades, total, temEstoque, situacao
    let estoquePendente = null;  // estoque importado antes da lista terminar de carregar

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

    // "57806.0" -> "57806" | "00000000000002 - ETI PORTA JOIAS" -> "2"
    // Mesma normalização usada nas demais abas, para os SKUs baterem.
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

    // Data da planilha -> Date (meia-noite local). Aceita o número de série do
    // Excel (46342 = 16/11/2026), um Date ou o texto "16/11/2026".
    function parseData(valor) {
        if (valor === undefined || valor === null || valor === '') return null;
        let data;
        if (typeof valor === 'number') {
            data = new Date(1899, 11, 30 + Math.floor(valor));
        } else if (valor instanceof Date) {
            data = new Date(valor.getFullYear(), valor.getMonth(), valor.getDate());
        } else {
            const partes = String(valor).trim().split('/');
            if (partes.length !== 3) return null;
            data = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
        }
        return isNaN(data.getTime()) ? null : data;
    }

    // 0.4 -> 40 | 40 -> 40 | "40%" -> 40
    function parsePercentual(valor) {
        if (valor === undefined || valor === null || valor === '') return 0;
        const numero = typeof valor === 'number'
            ? valor
            : parseFloat(String(valor).replace('%', '').replace(',', '.'));
        if (isNaN(numero)) return 0;
        return numero <= 1 ? numero * 100 : numero;
    }

    // 40 -> "40%" | 25.08961 -> "25,1%"
    function formatarPercentual(valor) {
        return valor.toFixed(1).replace('.', ',').replace(/,0$/, '') + '%';
    }

    // "Sim - Liberado com até 70%" -> 70
    function limiteLMB(texto) {
        const achado = String(texto || '').match(/(\d+)\s*%/);
        return achado ? Number(achado[1]) : null;
    }

    function hojeMeiaNoite() {
        const agora = new Date();
        return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    }

    function diaMes(data) {
        return String(data.getDate()).padStart(2, '0') + '/' + String(data.getMonth() + 1).padStart(2, '0');
    }

    function dataCompleta(data) {
        return diaMes(data) + '/' + data.getFullYear();
    }

    // Situação do item no outlet em relação a hoje
    function calcularSituacao(item, hoje) {
        if (hoje < item.inicio) {
            return { chave: 'futura', dias: Math.round((item.inicio - hoje) / DIA_MS) };
        }
        if (hoje > item.fim) return { chave: 'encerrada', dias: 0 };
        return { chave: 'ativa', dias: Math.round((item.fim - hoje) / DIA_MS) };
    }

    function textoSituacao(situacao) {
        if (situacao.chave === 'ativa') return situacao.dias === 0 ? 'Último dia hoje' : 'Valendo hoje';
        if (situacao.chave === 'encerrada') return 'Encerrada';
        return situacao.dias === 1 ? 'Começa amanhã' : `Começa em ${situacao.dias} dias`;
    }

    // --- 1. Leitura da lista da Semana Outlet ---
    function extrairItens(workbook) {
        const porCondicao = new Map(); // sku|marca|bso|%|+L+B -> item

        workbook.SheetNames.forEach(nomeAba => {
            const linhas = XLSX.utils.sheet_to_json(workbook.Sheets[nomeAba], { defval: '' });

            linhas.forEach(linha => {
                const sku = normalizarSKU(valorFlexivel(linha, ['Cód. Item', 'Cod. Item', 'Código Item', 'Codigo Item', 'SKU']));
                const inicio = parseData(valorFlexivel(linha, ['Data Início', 'Data Inicio']));
                const fim = parseData(valorFlexivel(linha, ['Data Fim']));
                if (!sku || !inicio || !fim) return;

                const codigoMarca = String(valorFlexivel(linha, ['Unidade Negócio', 'Unidade Negocio', 'Marca']) || '').trim().toUpperCase();
                const temBSO = String(valorFlexivel(linha, ['BSO Indústria', 'BSO Industria']) || '').trim().toLowerCase().startsWith('s');
                const descontoBSO = temBSO ? parsePercentual(valorFlexivel(linha, ['% Desconto (com BSO)', '% Desconto'])) : 0;
                const lmb = String(valorFlexivel(linha, ['Disponível +L+B', 'Disponivel +L+B']) || '').trim();

                const chave = [sku, codigoMarca, temBSO, descontoBSO.toFixed(4), lmb].join('|');
                const existente = porCondicao.get(chave);

                // Mesma condição repetida: fica o período mais longo
                if (existente) {
                    if (inicio < existente.inicio) existente.inicio = inicio;
                    if (fim > existente.fim) existente.fim = fim;
                    return;
                }

                porCondicao.set(chave, {
                    sku: sku,
                    descricao: String(valorFlexivel(linha, ['Descrição Item', 'Descricao Item', 'Descrição Produto']) || '').trim(),
                    marca: NOMES_MARCA[codigoMarca] || codigoMarca || 'Sem marca',
                    categoria: String(valorFlexivel(linha, ['Categoria']) || '').trim(),
                    subcategoria: String(valorFlexivel(linha, ['Subcategoria']) || '').trim(),
                    inicio: inicio,
                    fim: fim,
                    temBSO: temBSO,
                    descontoBSO: descontoBSO,
                    lmb: lmb,
                    limiteLMB: limiteLMB(lmb)
                });
            });
        });

        return Array.from(porCondicao.values());
    }

    function carregarPlanilha() {
        fetch('./' + encodeURIComponent(ARQUIVO_OUTLET), { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error('não encontrado');
                return response.arrayBuffer();
            })
            .then(data => {
                const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
                itensOutlet = extrairItens(workbook);

                if (itensOutlet.length === 0) throw new Error('sem SKUs');

                preencherFiltros();

                const totalSkus = new Set(itensOutlet.map(i => i.sku)).size;
                el('status-outlet').textContent =
                    `✅ Lista da Semana Outlet carregada (${totalSkus} SKUs) · situação calculada para hoje, ${dataCompleta(hojeMeiaNoite())}`;
                el('tab-count-outlet').textContent = totalSkus;

                // Estoque importado antes desta lista ficar pronta
                if (estoquePendente) {
                    cruzarComEstoque(estoquePendente);
                    estoquePendente = null;
                }
            })
            .catch(() => {
                const status = el('status-outlet');
                status.textContent = '❌ semanaoutlet.xlsx não encontrado na raiz.';
                status.classList.add('status-erro');
            });
    }

    function preencherSelect(id, rotuloTodos, opcoes) {
        const select = el(id);
        if (!select) return;

        select.innerHTML = `<option value="">${rotuloTodos}</option>`;
        opcoes.forEach(opcao => {
            const option = document.createElement('option');
            option.value = opcao.valor;
            option.textContent = opcao.texto;
            select.appendChild(option);
        });
    }

    function opcoesSimples(valores) {
        return valores.map(v => ({ valor: v, texto: v }));
    }

    function preencherFiltros() {
        const marcas = Array.from(new Set(itensOutlet.map(i => i.marca))).sort();
        preencherSelect('outletFiltroMarca', 'Todas as Marcas', opcoesSimples(marcas));

        const categorias = Array.from(new Set(itensOutlet.map(i => i.categoria).filter(Boolean))).sort();
        preencherSelect('outletFiltroCategoria', 'Todas as Categorias', opcoesSimples(categorias));

        // Datas fim em ordem cronológica: "Até 22/11", "Até 25/11", "Até 30/11"
        const fins = Array.from(new Set(itensOutlet.map(i => i.fim.getTime()))).sort((a, b) => a - b);
        preencherSelect('outletFiltroFim', 'Todas as datas', fins.map(t => ({
            valor: String(t),
            texto: 'Até ' + diaMes(new Date(t))
        })));
    }

    // --- 2. Cruzamento com a planilha de estoque ---
    function cruzarComEstoque(estoque) {
        // sku -> { '13706': qtd, '13707': qtd }
        const saldoPorSku = new Map();

        estoque.forEach(item => {
            const sku = normalizarSKU(valorFlexivel(item, ['Produto', 'Código Produto', 'Codigo Produto']));
            if (!sku) return;

            const unidade = String(valorFlexivel(item, ['Quebra', 'Loja']) || '').trim();
            const saldo = parseQuantidade(valorFlexivel(item, ['Saldo Atual', 'Estoque Final']));

            let registro = saldoPorSku.get(sku);
            if (!registro) {
                registro = {};
                UNIDADES.forEach(u => { registro[u.codigo] = 0; });
                saldoPorSku.set(sku, registro);
            }

            if (Object.prototype.hasOwnProperty.call(registro, unidade)) {
                registro[unidade] += saldo;
            }
        });

        const hoje = hojeMeiaNoite();

        linhasCruzadas = itensOutlet.map(item => {
            const registro = saldoPorSku.get(item.sku);
            const quantidades = {};
            let total = 0;

            UNIDADES.forEach(u => {
                const qtd = registro ? registro[u.codigo] : 0;
                quantidades[u.codigo] = qtd;
                total += qtd;
            });

            return Object.assign({}, item, {
                quantidades: quantidades,
                total: total,
                temEstoque: total > 0,
                situacao: calcularSituacao(item, hoje)
            });
        });

        // Valendo hoje primeiro, depois as que saem do outlet antes, depois por marca e nome
        linhasCruzadas.sort((a, b) =>
            ORDEM_SITUACAO[a.situacao.chave] - ORDEM_SITUACAO[b.situacao.chave]
            || a.fim - b.fim
            || a.marca.localeCompare(b.marca)
            || a.descricao.localeCompare(b.descricao)
        );

        el('outlet-placeholder').classList.add('hidden');
        el('outlet-content').classList.remove('hidden');
        renderizar();
    }

    // --- 3. Filtros e renderização ---
    function obterLinhasFiltradas() {
        const busca = el('outletSearch').value.trim().toLowerCase();
        const marca = el('outletFiltroMarca').value;
        const categoria = el('outletFiltroCategoria').value;
        const fim = el('outletFiltroFim').value;
        const bso = el('outletFiltroBSO').value;
        const lmb = el('outletFiltroLMB').value;
        const estoque = el('outletFiltroEstoque').value;

        return linhasCruzadas.filter(linha => {
            if (busca && !(`${linha.sku} ${linha.descricao} ${linha.subcategoria}`.toLowerCase().includes(busca))) return false;
            if (marca && linha.marca !== marca) return false;
            if (categoria && linha.categoria !== categoria) return false;
            if (fim && String(linha.fim.getTime()) !== fim) return false;
            if (bso === 'sim' && !linha.temBSO) return false;
            if (bso === 'nao' && linha.temBSO) return false;
            if (lmb && String(linha.limiteLMB) !== lmb) return false;
            if (estoque === 'com' && !linha.temEstoque) return false;
            if (estoque === 'sem' && linha.temEstoque) return false;
            return true;
        });
    }

    function celulaQuantidade(qtd) {
        return qtd > 0
            ? `<span class="qtd-pill qtd-ok">${formatarQuantidade(qtd)}</span>`
            : `<span class="qtd-pill qtd-zero">0</span>`;
    }

    function classeMarca(marca) {
        const nome = marca.toLowerCase();
        if (nome.includes('boticario') || nome.includes('boticário')) return 'marca-boti';
        if (nome.includes('eudora')) return 'marca-eudora';
        if (nome === 'qdb' || nome.includes('berenice')) return 'marca-qdb';
        if (nome === 'oui' || nome === 'o.u.i') return 'marca-oui';
        return '';
    }

    function celulaSituacao(situacao) {
        return `<span class="vig-pill vig-${situacao.chave}">${escapar(textoSituacao(situacao))}</span>`;
    }

    // "40% c/ BSO" (ou "Sem BSO") e, embaixo, o limite liberado no +L+B
    function celulaDesconto(linha) {
        const bso = linha.temBSO
            ? `<span class="bw-desconto">${formatarPercentual(linha.descontoBSO)}</span> <span class="outlet-bso">c/ BSO</span>`
            : `<span class="outlet-sem-bso">Sem BSO</span>`;
        const lmb = linha.limiteLMB !== null ? `<small>+L+B até ${linha.limiteLMB}%</small>` : '';
        return bso + lmb;
    }

    function detalheDescricao(linha) {
        const partes = [linha.categoria, linha.subcategoria].filter(Boolean);
        return partes.length ? `<small>${escapar(partes.join(' · '))}</small>` : '';
    }

    function renderizar() {
        const corpo = el('outlet-tbody');
        const linhas = obterLinhasFiltradas();

        corpo.innerHTML = linhas.map(linha => `
            <tr class="${linha.temEstoque ? 'linha-tem' : 'linha-nao-tem'}">
                <td class="col-sku">${escapar(linha.sku)}</td>
                <td class="col-desc">${escapar(linha.descricao)}${detalheDescricao(linha)}</td>
                <td class="col-marca"><span class="badge-marca ${classeMarca(linha.marca)}">${escapar(linha.marca)}</span></td>
                <td class="col-vigencia">${diaMes(linha.inicio)} → ${diaMes(linha.fim)}</td>
                <td class="col-situacao">${celulaSituacao(linha.situacao)}</td>
                <td class="col-desconto">${celulaDesconto(linha)}</td>
                <td class="col-qtd">${celulaQuantidade(linha.quantidades['13706'])}</td>
                <td class="col-qtd">${celulaQuantidade(linha.quantidades['13707'])}</td>
                <td class="col-qtd"><strong>${formatarQuantidade(linha.total)}</strong></td>
            </tr>
        `).join('');

        el('outlet-msg-vazio').style.display = linhas.length === 0 ? 'block' : 'none';

        atualizarResumo();
    }

    // Resumo por SKU (um SKU pode ter mais de uma linha) e sobre a lista completa, não o filtro
    function atualizarResumo() {
        const porSku = new Map();
        linhasCruzadas.forEach(linha => {
            const atual = porSku.get(linha.sku) || { temEstoque: linha.temEstoque, temBSO: false };
            if (linha.temBSO) atual.temBSO = true;
            porSku.set(linha.sku, atual);
        });

        let com = 0, comBSO = 0, sem = 0;
        porSku.forEach(sku => {
            if (!sku.temEstoque) { sem++; return; }
            com++;
            if (sku.temBSO) comBSO++;
        });

        el('outlet-com').textContent = com;
        el('outlet-bso').textContent = comBSO;
        el('outlet-sem').textContent = sem;
        el('outlet-total').textContent = porSku.size;
        el('tab-count-outlet').textContent = com;
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
            Marca: linha.marca,
            Categoria: linha.categoria,
            Subcategoria: linha.subcategoria,
            'Início': dataCompleta(linha.inicio),
            Fim: dataCompleta(linha.fim),
            'Situação hoje': textoSituacao(linha.situacao),
            'BSO Indústria': linha.temBSO ? 'Sim' : 'Não',
            '% Desconto (com BSO)': linha.temBSO ? Math.round(linha.descontoBSO * 10) / 10 : 0,
            'Disponível +L+B': linha.lmb,
            'Palmeira (13706)': linha.quantidades['13706'],
            'Penedo (13707)': linha.quantidades['13707'],
            Total: linha.total
        }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), 'Semana Outlet');
        XLSX.writeFile(wb, 'SemanaOutlet_Estoque.xlsx');
    }

    // --- Inicialização ---
    window.addEventListener('DOMContentLoaded', () => {
        carregarPlanilha();

        el('outletSearch').addEventListener('keyup', renderizar);
        ['outletFiltroMarca', 'outletFiltroCategoria', 'outletFiltroFim', 'outletFiltroBSO', 'outletFiltroLMB', 'outletFiltroEstoque'].forEach(id => {
            el(id).addEventListener('change', renderizar);
        });
        el('btn-export-outlet').addEventListener('click', exportar);

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

                    // A lista da Semana Outlet ainda pode estar carregando
                    if (itensOutlet.length === 0) {
                        estoquePendente = estoque;
                        return;
                    }
                    cruzarComEstoque(estoque);
                } catch (err) {
                    const status = el('status-outlet');
                    status.textContent = '❌ Erro ao cruzar a planilha de estoque: ' + err.message;
                    status.classList.add('status-erro');
                }
            };
            reader.readAsArrayBuffer(arquivo);
        });
    });
})();
