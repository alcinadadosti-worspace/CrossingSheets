// --- Funções Auxiliares ---
function obterValorFlexivel(linha, nomeColunaAlvo) {
    const chaves = Object.keys(linha);
    const chaveEncontrada = chaves.find(k => k.trim().toLowerCase() === nomeColunaAlvo.trim().toLowerCase());
    return chaveEncontrada ? linha[chaveEncontrada] : undefined;
}

// Função para buscar descrição com diferentes encodings/variações
function obterDescricaoFlexivel(linha) {
    const chaves = Object.keys(linha);
    // Busca por colunas que contenham "descri" (ignora acentos e encoding)
    const chaveEncontrada = chaves.find(k => {
        const chaveLower = k.trim().toLowerCase();
        return chaveLower.includes('descri') ||
               chaveLower.includes('descric') ||
               chaveLower.includes('nome') ||
               chaveLower === 'description';
    });
    return chaveEncontrada ? linha[chaveEncontrada] : undefined;
}

// Preenche um <select> com os valores de um Set, em ordem alfabética
function preencherSelect(idSelect, rotuloTodos, valores) {
    const select = document.getElementById(idSelect);
    if (!select) return;

    select.innerHTML = `<option value="">${rotuloTodos}</option>`;

    Array.from(valores).sort().forEach(valor => {
        const option = document.createElement('option');
        option.value = valor;
        option.textContent = valor;
        select.appendChild(option);
    });
}

// Escapa texto vindo das planilhas antes de inserir no HTML (ex.: "(<= 100 dias)")
function escaparHtml(texto) {
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Extrai o percentual liberado ("Sim - Até 30%" -> "30"); bloqueados não têm percentual
function extrairPercentualDesconto(texto) {
    if (!texto) return null;
    const achado = String(texto).match(/(\d+)\s*%/);
    return achado ? achado[1] : null;
}

// Função para aplicar todos os filtros
function aplicarFiltros() {
    const termoBusca = document.getElementById('searchInput').value.toLowerCase();
    const marcaFiltro = document.getElementById('filtroMarca').value;
    const categoriaFiltro = document.getElementById('filtroCategoria').value;
    const descontoFiltro = document.getElementById('filtroDesconto').value;

    const cards = document.querySelectorAll('.product-card');

    cards.forEach(card => {
        const textoCard = card.getAttribute('data-search');
        const marcaCard = card.getAttribute('data-marca');
        const categoriaCard = card.getAttribute('data-categoria');
        const percentualCard = card.getAttribute('data-percentual');

        let visivel = true;

        // Filtro de busca por texto
        if (termoBusca && !textoCard.includes(termoBusca)) {
            visivel = false;
        }

        // Filtro de marca
        if (marcaFiltro && marcaCard !== marcaFiltro) {
            visivel = false;
        }

        // Filtro de categoria
        if (categoriaFiltro && categoriaCard !== categoriaFiltro) {
            visivel = false;
        }

        // Filtro de desconto (percentual exato liberado)
        if (descontoFiltro && percentualCard !== descontoFiltro) {
            visivel = false;
        }

        card.style.display = visivel ? 'block' : 'none';
    });
}

let promoSKUs = [];
let promoDados = {}; // Armazena dados completos do BD (Categoria, Permitido desconto)
// Arrays para armazenar os dados prontos para exportação
let dadosPalmeira = [];
let dadosPenedo = [];
// Listas de marcas e categorias únicas para os filtros
let marcasDisponiveis = new Set();
let categoriasDisponiveis = new Set();

// 1. Carregar BD
window.addEventListener('DOMContentLoaded', () => {
    fetch('./bd.xlsx', { cache: 'no-store' })
        .then(response => {
            if (!response.ok) throw new Error("Erro ao buscar bd.xlsx");
            return response.arrayBuffer();
        })
        .then(data => {
            const workbook = XLSX.read(data, {type: 'array'});
            let jsonBD = [];
            workbook.SheetNames.forEach(sheetName => {
                const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
                jsonBD = jsonBD.concat(sheetData);
            });
            
            jsonBD.forEach(item => {
                let codigo = obterValorFlexivel(item, 'Código Produto');
                if (!codigo) codigo = obterValorFlexivel(item, 'Codigo Produto');

                if (codigo) {
                    const sku = String(codigo).trim();
                    promoSKUs.push(sku);

                    // Buscar Marca (BOTICARIO, EUDORA, OUI, QDB, AUMIGOS, AMOSTRAS...)
                    let marca = obterValorFlexivel(item, 'Marca') || 'Sem marca';
                    marca = String(marca).trim();
                    marcasDisponiveis.add(marca);

                    // Buscar Categoria
                    let categoria = obterValorFlexivel(item, 'Categoria') || 'Sem categoria';
                    categoria = String(categoria).trim();
                    categoriasDisponiveis.add(categoria);

                    // Buscar Permitido desconto ou brinde
                    let permitido = obterValorFlexivel(item, 'Permitido desconto ou brinde?')
                                 || obterValorFlexivel(item, 'Permitido desconto ou brinde')
                                 || '';
                    permitido = String(permitido).trim();

                    // Motivo da liberação/bloqueio (coluna nova a partir do ciclo 16)
                    let observacao = obterValorFlexivel(item, 'Observação regra') || '';
                    observacao = String(observacao).trim();

                    const descricao = obterValorFlexivel(item, 'Descrição Produto') || '';

                    promoDados[sku] = {
                        marca: marca,
                        categoria: categoria,
                        permitidoDesconto: permitido,
                        observacao: observacao,
                        descricao: String(descricao).trim()
                    };
                }
            });

            // Preencher filtros de marca e categoria
            preencherSelect('filtroMarca', 'Todas as Marcas', marcasDisponiveis);
            preencherSelect('filtroCategoria', 'Todas as Categorias', categoriasDisponiveis);

            document.getElementById('status-bd').textContent = `✅ Banco de dados carregado (${promoSKUs.length} produtos)`;
        })
        .catch(error => {
            document.getElementById('status-bd').textContent = "❌ Erro: bd.xlsx não encontrado na raiz.";
            document.getElementById('status-bd').style.color = "red";
        });
});

// 2. Upload Estoque
document.getElementById('upload').addEventListener('change', (evt) => {
    const file = evt.target.files[0];
    if (!file) return;

    if (promoSKUs.length === 0) {
        alert("Aguarde o carregamento do BD.");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const ws = workbook.Sheets[workbook.SheetNames[0]];
            const jsonEstoque = XLSX.utils.sheet_to_json(ws, {raw: false});

            processarDados(jsonEstoque);
        } catch (err) {
            alert("Erro ao ler planilha: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
});

function processarDados(estoque) {
    const list13706 = document.getElementById('list-13706');
    const list13707 = document.getElementById('list-13707');

    // Limpa visualização e dados de exportação
    list13706.innerHTML = '';
    list13707.innerHTML = '';
    dadosPalmeira = [];
    dadosPenedo = [];
    // Volta a mostrar "Nenhum item encontrado" até aparecer um item da unidade
    document.getElementById('msg-13706').style.display = '';
    document.getElementById('msg-13707').style.display = '';

    let matches = 0;

    estoque.forEach(item => {
        const skuBruto = obterValorFlexivel(item, 'Produto');
        const saldoBruto = obterValorFlexivel(item, 'Saldo Atual')
                        || obterValorFlexivel(item, 'Estoque Final');
        const quebraBruto = obterValorFlexivel(item, 'Quebra')
                         || obterValorFlexivel(item, 'Loja');
        let descBruto = obterValorFlexivel(item, 'Descricao')
                      || obterValorFlexivel(item, 'Descrição')
                      || obterDescricaoFlexivel(item);

        let skuStr = skuBruto ? String(skuBruto).trim() : null;

        // Formato "00000000000002 - Descrição": extrair SKU e descrição
        if (skuStr && skuStr.includes(' - ')) {
            const partes = skuStr.split(' - ');
            skuStr = partes[0].trim();
            if (!descBruto) {
                descBruto = partes.slice(1).join(' - ').trim();
            }
        }

        const skuNum = skuStr ? Number(skuStr) : NaN;
        const sku = skuStr ? (isNaN(skuNum) ? skuStr : String(skuNum)) : null;
        const saldoStr = saldoBruto ? String(saldoBruto).replace(',', '.') : '';
        const saldo = parseFloat(saldoStr);
        const quebra = quebraBruto ? String(quebraBruto).trim() : '';

        if (sku && Object.hasOwn(promoDados, sku) && saldo > 0) {
            matches++;

            // Buscar dados adicionais do BD
            const dadosBD = promoDados[sku];
            const { marca, categoria, permitidoDesconto, observacao } = dadosBD;
            const percentual = extrairPercentualDesconto(permitidoDesconto);

            // Objeto limpo para o Excel e para o Card
            const produtoObj = {
                SKU: sku,
                Descricao: descBruto || dadosBD.descricao || 'Item Promocional',
                Saldo: saldo,
                Marca: marca,
                Categoria: categoria,
                'Permitido Desconto/Brinde': permitidoDesconto,
                'Observação Regra': observacao
            };

            // Badge de desconto só para itens liberados (com percentual)
            const badgeDesconto = percentual
                ? `<span class="badge-desconto desconto-${percentual}">${percentual}%</span>`
                : '';
            const badgeCategoria = categoria !== 'Sem categoria'
                ? `<span class="badge-categoria">${escaparHtml(categoria)}</span>`
                : '';

            // HTML Card
            const card = document.createElement('div');
            card.className = 'product-card';
            card.setAttribute('data-search', `${sku} ${produtoObj.Descricao}`.toLowerCase());
            card.setAttribute('data-marca', marca);
            card.setAttribute('data-categoria', categoria);
            card.setAttribute('data-percentual', percentual || '');

            card.innerHTML = `
                <div class="card-header-info">
                    <span class="badge-marca-promo">${escaparHtml(marca)}</span>
                    ${badgeCategoria}
                    ${badgeDesconto}
                </div>
                <div class="sku">SKU: ${escaparHtml(sku)}</div>
                <div class="desc">${escaparHtml(produtoObj.Descricao)}</div>
                ${observacao ? `<div class="obs-regra">${escaparHtml(observacao)}</div>` : ''}
                <div class="saldo">Saldo: ${saldo}</div>
            `;

            if (quebra === '13706') {
                list13706.appendChild(card);
                dadosPalmeira.push(produtoObj); // Guarda para exportar depois
                document.getElementById('msg-13706').style.display = 'none';
            } else if (quebra === '13707') {
                list13707.appendChild(card);
                dadosPenedo.push(produtoObj); // Guarda para exportar depois
                document.getElementById('msg-13707').style.display = 'none';
            }
        }
    });

    document.getElementById('results').classList.remove('hidden');

    // Mantém os filtros já escolhidos valendo para os cards novos
    aplicarFiltros();

    if (matches === 0) {
        alert("Nenhum item do estoque bateu com a lista de promoções.");
    }
}

// 3. Funções de Pesquisa e Filtros
document.getElementById('searchInput').addEventListener('keyup', aplicarFiltros);
document.getElementById('filtroMarca').addEventListener('change', aplicarFiltros);
document.getElementById('filtroCategoria').addEventListener('change', aplicarFiltros);
document.getElementById('filtroDesconto').addEventListener('change', aplicarFiltros);

// 4. Funções de Exportação
function obterDadosFiltrados(listId, dadosOriginais) {
    const container = document.getElementById(listId);
    const cardsVisiveis = container.querySelectorAll('.product-card');

    // Coletar SKUs dos cards visíveis
    const skusVisiveis = [];
    cardsVisiveis.forEach(card => {
        if (card.style.display !== 'none') {
            // Extrair SKU do card
            const skuText = card.querySelector('.sku').textContent;
            const sku = skuText.replace('SKU: ', '').trim();
            skusVisiveis.push(sku);
        }
    });

    // Filtrar dados originais pelos SKUs visíveis
    return dadosOriginais.filter(item => skusVisiveis.includes(item.SKU));
}

function exportarExcel(listId, dados, nomeArquivo) {
    // Obter apenas os dados filtrados (visíveis na tela)
    const dadosFiltrados = obterDadosFiltrados(listId, dados);

    if (dadosFiltrados.length === 0) {
        alert("Não há dados visíveis nesta unidade para exportar. Verifique os filtros aplicados.");
        return;
    }

    // Cria uma nova planilha (Worksheet)
    const ws = XLSX.utils.json_to_sheet(dadosFiltrados);

    // Cria um novo arquivo (Workbook)
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Promoções");

    // Baixa o arquivo
    XLSX.writeFile(wb, nomeArquivo);
}

// Event Listeners dos Botões
document.getElementById('btn-export-13706').addEventListener('click', () => {
    exportarExcel('list-13706', dadosPalmeira, "Promocoes_Palmeira_13706.xlsx");
});

document.getElementById('btn-export-13707').addEventListener('click', () => {
    exportarExcel('list-13707', dadosPenedo, "Promocoes_Penedo_13707.xlsx");
});

// 5. Abas (Promoções do Ciclo / BotRecicla)
document.querySelectorAll('.tab-btn').forEach(botao => {
    botao.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

        botao.classList.add('active');
        document.getElementById('panel-' + botao.dataset.tab).classList.add('active');
    });
});