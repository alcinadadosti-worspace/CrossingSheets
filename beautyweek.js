/* =========================================================================
   Módulo independente: "Beauty Week"

   Cruza a lista de itens da Beauty Week (beautyweek.xlsx: O Boticário, QDB,
   O.U.I e Eudora VD) com a MESMA planilha de estoque importada na aba
   principal, mostrando quando cada promoção vale (início/fim), o período,
   o desconto e o saldo por unidade.

   O beautyweek.xlsx é uma versão normalizada da planilha original
   "bw-2026-itens-validos-bot_qdb_oui_eud-*.xlsx" (cada marca vinha num
   layout diferente). Colunas: Código Produto | Descrição Produto | Marca |
   Submarca | Categoria | Mecânica | Período | Início | Fim | Desconto % |
   Desconto

   Não depende do script.js nem do botrecicla.js: ouve o mesmo input de
   upload da planilha de estoque. Expõe window.BeautyWeek para a aba
   "Promoções do Ciclo" mostrar o alerta de Beauty Week nos cards:
     - BeautyWeek.pronto: Promise que resolve true quando a lista carregou
       (false se falhou) — nunca rejeita
     - BeautyWeek.alertasSku(sku): textos das promoções da BW ainda por
       vir ou valendo hoje para o SKU ([] se não estiver na BW)
   ========================================================================= */
(function () {
    'use strict';

    const ARQUIVO_BW = 'beautyweek.xlsx';

    const UNIDADES = [
        { codigo: '13706', nome: 'Palmeira dos Índios' },
        { codigo: '13707', nome: 'Penedo' }
    ];

    // Ordem cronológica dos períodos (para o filtro)
    const ORDEM_PERIODOS = ['Ciclo todo', 'Esquenta', 'Pré semana', 'Semana BW', 'Fim de semana', 'Cyber Monday'];

    const ORDEM_SITUACAO = { ativa: 0, futura: 1, encerrada: 2 };

    const DIA_MS = 24 * 60 * 60 * 1000;

    let itensBW = [];            // uma linha por promoção (um SKU pode ter mais de uma)
    let itensPorSku = new Map(); // sku -> [promoções]
    let linhasCruzadas = [];     // itensBW + quantidades, total, temEstoque, situacao
    let estoquePendente = null;  // estoque importado antes da lista terminar de carregar

    let resolverPronto;
    const pronto = new Promise(resolve => { resolverPronto = resolve; });

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

    // "03/11/2026" -> Date (meia-noite local)
    function parseData(texto) {
        const partes = String(texto || '').trim().split('/');
        if (partes.length !== 3) return null;
        const data = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
        return isNaN(data.getTime()) ? null : data;
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

    // Situação da promoção em relação a hoje
    function calcularSituacao(item, hoje) {
        if (hoje < item.inicio) {
            const dias = Math.round((item.inicio - hoje) / DIA_MS);
            return { chave: 'futura', dias: dias };
        }
        if (hoje > item.fim) return { chave: 'encerrada', dias: 0 };
        return { chave: 'ativa', dias: Math.round((item.fim - hoje) / DIA_MS) };
    }

    function textoSituacao(situacao) {
        if (situacao.chave === 'ativa') return 'Valendo hoje';
        if (situacao.chave === 'encerrada') return 'Encerrada';
        return situacao.dias === 1 ? 'Começa amanhã' : `Começa em ${situacao.dias} dias`;
    }

    // --- 1. Leitura da lista da Beauty Week ---
    function extrairItens(workbook) {
        const encontrados = [];

        workbook.SheetNames.forEach(nomeAba => {
            const linhas = XLSX.utils.sheet_to_json(workbook.Sheets[nomeAba], { defval: '' });

            linhas.forEach(linha => {
                const sku = normalizarSKU(valorFlexivel(linha, ['Código Produto', 'Codigo Produto', 'SKU']));
                const inicio = parseData(valorFlexivel(linha, ['Início', 'Inicio']));
                const fim = parseData(valorFlexivel(linha, ['Fim']));
                if (!sku || !inicio || !fim) return;

                const pct = valorFlexivel(linha, ['Desconto %']);

                encontrados.push({
                    sku: sku,
                    descricao: String(valorFlexivel(linha, ['Descrição Produto', 'Descricao Produto']) || '').trim(),
                    marca: String(valorFlexivel(linha, ['Marca']) || 'Sem marca').trim(),
                    submarca: String(valorFlexivel(linha, ['Submarca']) || '').trim(),
                    categoria: String(valorFlexivel(linha, ['Categoria']) || '').trim(),
                    mecanica: String(valorFlexivel(linha, ['Mecânica', 'Mecanica']) || '').trim(),
                    periodo: String(valorFlexivel(linha, ['Período', 'Periodo']) || '').trim(),
                    inicio: inicio,
                    fim: fim,
                    descontoPct: typeof pct === 'number' ? pct : null,
                    desconto: String(valorFlexivel(linha, ['Desconto']) || '').trim()
                });
            });
        });

        return encontrados;
    }

    function carregarPlanilha() {
        fetch('./' + encodeURIComponent(ARQUIVO_BW), { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error('não encontrado');
                return response.arrayBuffer();
            })
            .then(data => {
                const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
                itensBW = extrairItens(workbook);

                if (itensBW.length === 0) throw new Error('sem SKUs');

                itensPorSku = new Map();
                itensBW.forEach(item => {
                    if (!itensPorSku.has(item.sku)) itensPorSku.set(item.sku, []);
                    itensPorSku.get(item.sku).push(item);
                });
                resolverPronto(true);

                preencherFiltros();

                const totalSkus = new Set(itensBW.map(i => i.sku)).size;
                el('status-bw').textContent =
                    `✅ Lista da Beauty Week carregada (${totalSkus} SKUs) · situação calculada para hoje, ${dataCompleta(hojeMeiaNoite())}`;
                el('tab-count-bw').textContent = totalSkus;

                // Estoque importado antes desta lista ficar pronta
                if (estoquePendente) {
                    cruzarComEstoque(estoquePendente);
                    estoquePendente = null;
                }
            })
            .catch(() => {
                resolverPronto(false);
                const status = el('status-bw');
                status.textContent = '❌ beautyweek.xlsx não encontrado na raiz.';
                status.classList.add('status-erro');
            });
    }

    function preencherSelect(id, rotuloTodos, valores) {
        const select = el(id);
        if (!select) return;

        select.innerHTML = `<option value="">${rotuloTodos}</option>`;
        valores.forEach(valor => {
            const option = document.createElement('option');
            option.value = valor;
            option.textContent = valor;
            select.appendChild(option);
        });
    }

    function preencherFiltros() {
        const marcas = Array.from(new Set(itensBW.map(i => i.marca))).sort();
        preencherSelect('bwFiltroMarca', 'Todas as Marcas', marcas);

        const presentes = new Set(itensBW.map(i => i.periodo));
        const periodos = ORDEM_PERIODOS.filter(p => presentes.has(p))
            .concat(Array.from(presentes).filter(p => !ORDEM_PERIODOS.includes(p)).sort());
        preencherSelect('bwFiltroPeriodo', 'Todos os Períodos', periodos);
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

        linhasCruzadas = itensBW.map(item => {
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

        // Valendo hoje primeiro, depois as que começam antes, depois por marca e nome
        linhasCruzadas.sort((a, b) =>
            ORDEM_SITUACAO[a.situacao.chave] - ORDEM_SITUACAO[b.situacao.chave]
            || a.inicio - b.inicio
            || a.marca.localeCompare(b.marca)
            || a.descricao.localeCompare(b.descricao)
        );

        el('bw-placeholder').classList.add('hidden');
        el('bw-content').classList.remove('hidden');
        renderizar();
    }

    // --- 3. Filtros e renderização ---
    function obterLinhasFiltradas() {
        const busca = el('bwSearch').value.trim().toLowerCase();
        const marca = el('bwFiltroMarca').value;
        const periodo = el('bwFiltroPeriodo').value;
        const vigencia = el('bwFiltroVigencia').value;
        const estoque = el('bwFiltroEstoque').value;

        return linhasCruzadas.filter(linha => {
            if (busca && !(`${linha.sku} ${linha.descricao} ${linha.submarca}`.toLowerCase().includes(busca))) return false;
            if (marca && linha.marca !== marca) return false;
            if (periodo && linha.periodo !== periodo) return false;
            if (vigencia && linha.situacao.chave !== vigencia) return false;
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

    // "Progressivo 1: 15% | 2: 20% | 3+: 25%" vira "Progressivo" + uma faixa por linha
    // ("1 un: 15%", "2 un: 20%"...), para não alargar a tabela
    function celulaDesconto(desconto) {
        const partes = String(desconto || '-')
            .replace(/^Progressivo\s+/i, 'Progressivo|')
            .split('|')
            .map(p => p.trim().replace(/^(\d+\+?):/, '$1 un:'))
            .filter(Boolean);
        return `<span class="bw-desconto">${partes.map(escapar).join('<br>')}</span>`;
    }

    function detalheDescricao(linha) {
        const partes = [linha.submarca, linha.categoria].filter(Boolean);
        if (linha.mecanica && linha.mecanica !== 'Desconto Direto') partes.push(linha.mecanica);
        return partes.length ? `<small>${escapar(partes.join(' · '))}</small>` : '';
    }

    function renderizar() {
        const corpo = el('bw-tbody');
        const linhas = obterLinhasFiltradas();

        corpo.innerHTML = linhas.map(linha => `
            <tr class="${linha.temEstoque ? 'linha-tem' : 'linha-nao-tem'}">
                <td class="col-sku">${escapar(linha.sku)}</td>
                <td class="col-desc">${escapar(linha.descricao)}${detalheDescricao(linha)}</td>
                <td class="col-marca"><span class="badge-marca ${classeMarca(linha.marca)}">${escapar(linha.marca)}</span></td>
                <td class="col-vigencia">${diaMes(linha.inicio)} → ${diaMes(linha.fim)}<small>${escapar(linha.periodo)}</small></td>
                <td class="col-situacao">${celulaSituacao(linha.situacao)}</td>
                <td class="col-desconto">${celulaDesconto(linha.desconto)}</td>
                <td class="col-qtd">${celulaQuantidade(linha.quantidades['13706'])}</td>
                <td class="col-qtd">${celulaQuantidade(linha.quantidades['13707'])}</td>
                <td class="col-qtd"><strong>${formatarQuantidade(linha.total)}</strong></td>
            </tr>
        `).join('');

        el('bw-msg-vazio').style.display = linhas.length === 0 ? 'block' : 'none';

        atualizarResumo();
    }

    // Resumo por SKU (um SKU pode ter mais de uma promoção) e sobre a lista completa, não o filtro
    function atualizarResumo() {
        const porSku = new Map();
        linhasCruzadas.forEach(linha => {
            const atual = porSku.get(linha.sku) || { temEstoque: linha.temEstoque, ativa: false, futura: false };
            if (linha.situacao.chave === 'ativa') atual.ativa = true;
            if (linha.situacao.chave === 'futura') atual.futura = true;
            porSku.set(linha.sku, atual);
        });

        let hoje = 0, depois = 0, sem = 0;
        porSku.forEach(sku => {
            if (!sku.temEstoque) sem++;
            else if (sku.ativa) hoje++;
            else if (sku.futura) depois++;
        });

        el('bw-hoje').textContent = hoje;
        el('bw-depois').textContent = depois;
        el('bw-sem').textContent = sem;
        el('bw-total').textContent = porSku.size;
        el('tab-count-bw').textContent = porSku.size - sem;
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
            Submarca: linha.submarca,
            Categoria: linha.categoria,
            'Mecânica': linha.mecanica,
            'Período': linha.periodo,
            'Início': dataCompleta(linha.inicio),
            Fim: dataCompleta(linha.fim),
            'Situação hoje': textoSituacao(linha.situacao),
            Desconto: linha.desconto,
            'Desconto %': linha.descontoPct,
            'Palmeira (13706)': linha.quantidades['13706'],
            'Penedo (13707)': linha.quantidades['13707'],
            Total: linha.total
        }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), 'Beauty Week');
        XLSX.writeFile(wb, 'BeautyWeek_Estoque.xlsx');
    }

    // --- 5. API para a aba "Promoções do Ciclo" ---

    // "Entra na Beauty Week em 26/11 · 30% (Fim de semana, até 30/11)"
    // "Na Beauty Week desde 03/11 · 50% (Ciclo todo, até 30/11)"
    // Promoções já encerradas não geram alerta.
    function alertasSku(sku) {
        const promocoes = itensPorSku.get(normalizarSKU(sku)) || [];
        const hoje = hojeMeiaNoite();

        return promocoes
            .map(item => ({ item: item, situacao: calcularSituacao(item, hoje) }))
            .filter(p => p.situacao.chave !== 'encerrada')
            .sort((a, b) => a.item.inicio - b.item.inicio)
            .map(({ item, situacao }) => {
                const inicio = situacao.chave === 'futura'
                    ? `Entra na Beauty Week em ${diaMes(item.inicio)}`
                    : `Na Beauty Week desde ${diaMes(item.inicio)}`;
                const desconto = item.desconto ? ` · ${item.desconto}` : '';
                return `${inicio}${desconto} (${item.periodo}, até ${diaMes(item.fim)})`;
            });
    }

    window.BeautyWeek = {
        pronto: pronto,
        alertasSku: alertasSku
    };

    // --- Inicialização ---
    window.addEventListener('DOMContentLoaded', () => {
        carregarPlanilha();

        el('bwSearch').addEventListener('keyup', renderizar);
        ['bwFiltroMarca', 'bwFiltroPeriodo', 'bwFiltroVigencia', 'bwFiltroEstoque'].forEach(id => {
            el(id).addEventListener('change', renderizar);
        });
        el('btn-export-bw').addEventListener('click', exportar);

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

                    // A lista da Beauty Week ainda pode estar carregando
                    if (itensBW.length === 0) {
                        estoquePendente = estoque;
                        return;
                    }
                    cruzarComEstoque(estoque);
                } catch (err) {
                    const status = el('status-bw');
                    status.textContent = '❌ Erro ao cruzar a planilha de estoque: ' + err.message;
                    status.classList.add('status-erro');
                }
            };
            reader.readAsArrayBuffer(arquivo);
        });
    });
})();
