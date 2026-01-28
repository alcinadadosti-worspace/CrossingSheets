// --- Funções Auxiliares ---
function obterValorFlexivel(linha, nomeColunaAlvo) {
    const chaves = Object.keys(linha);
    const chaveEncontrada = chaves.find(k => k.trim().toLowerCase() === nomeColunaAlvo.trim().toLowerCase());
    return chaveEncontrada ? linha[chaveEncontrada] : undefined;
}

// Função para preencher o filtro de categorias
function preencherFiltroCategorias() {
    const selectCategoria = document.getElementById('filtroCategoria');
    if (!selectCategoria) return;

    // Limpar opções existentes (exceto a primeira)
    selectCategoria.innerHTML = '<option value="">Todas as Categorias</option>';

    // Ordenar categorias alfabeticamente
    const categoriasOrdenadas = Array.from(categoriasDisponiveis).sort();

    categoriasOrdenadas.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        selectCategoria.appendChild(option);
    });
}

// Função para extrair o percentual do texto de desconto
function extrairPercentualDesconto(texto) {
    if (!texto) return null;
    const textoLower = texto.toLowerCase();
    if (textoLower.includes('100%')) return '100';
    if (textoLower.includes('50%')) return '50';
    if (textoLower.includes('sim') || textoLower.includes('liberado')) return 'sim';
    return null;
}

// Função para aplicar todos os filtros
function aplicarFiltros() {
    const termoBusca = document.getElementById('searchInput').value.toLowerCase();
    const categoriaFiltro = document.getElementById('filtroCategoria').value;
    const descontoFiltro = document.getElementById('filtroDesconto').value;

    const cards = document.querySelectorAll('.product-card');

    cards.forEach(card => {
        const textoCard = card.getAttribute('data-search');
        const categoriaCard = card.getAttribute('data-categoria');
        const descontoCard = card.getAttribute('data-desconto');

        let visivel = true;

        // Filtro de busca por texto
        if (termoBusca && !textoCard.includes(termoBusca)) {
            visivel = false;
        }

        // Filtro de categoria
        if (categoriaFiltro && categoriaCard !== categoriaFiltro) {
            visivel = false;
        }

        // Filtro de desconto
        if (descontoFiltro) {
            if (descontoFiltro === '100' && !descontoCard.includes('100')) {
                visivel = false;
            } else if (descontoFiltro === '50' && !descontoCard.includes('50')) {
                visivel = false;
            } else if (descontoFiltro === 'sim' && descontoCard === '') {
                visivel = false;
            }
        }

        card.style.display = visivel ? 'block' : 'none';
    });
}

let promoSKUs = [];
let promoDados = {}; // Armazena dados completos do BD (Categoria, Permitido desconto)
// Arrays para armazenar os dados prontos para exportação
let dadosPalmeira = [];
let dadosPenedo = [];
// Lista de categorias únicas para o filtro
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
            const jsonBD = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            
            jsonBD.forEach(item => {
                let codigo = obterValorFlexivel(item, 'Código Produto');
                if (!codigo) codigo = obterValorFlexivel(item, 'Codigo Produto');

                if (codigo) {
                    const sku = String(codigo).trim();
                    promoSKUs.push(sku);

                    // Buscar Categoria
                    let categoria = obterValorFlexivel(item, 'Categoria') || 'Sem categoria';
                    categoria = String(categoria).trim();
                    categoriasDisponiveis.add(categoria);

                    // Buscar Permitido desconto ou brinde
                    let permitido = obterValorFlexivel(item, 'Permitido desconto ou brinde?')
                                 || obterValorFlexivel(item, 'Permitido desconto ou brinde')
                                 || '';
                    permitido = String(permitido).trim();

                    promoDados[sku] = {
                        categoria: categoria,
                        permitidoDesconto: permitido
                    };
                }
            });

            // Preencher filtro de categorias
            preencherFiltroCategorias();

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
            const jsonEstoque = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            
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
    
    let matches = 0;

    estoque.forEach(item => {
        const skuBruto = obterValorFlexivel(item, 'Produto');
        const saldoBruto = obterValorFlexivel(item, 'Saldo Atual');
        const quebraBruto = obterValorFlexivel(item, 'Quebra');
        const descBruto = obterValorFlexivel(item, 'Descricao') || obterValorFlexivel(item, 'Descrição');

        const sku = skuBruto ? String(skuBruto).trim() : null;
        const saldo = parseFloat(saldoBruto);
        const quebra = quebraBruto ? String(quebraBruto).trim() : '';

        if (sku && promoSKUs.includes(sku) && saldo > 0) {
            matches++;

            // Buscar dados adicionais do BD
            const dadosBD = promoDados[sku] || { categoria: 'Sem categoria', permitidoDesconto: '' };
            const categoria = dadosBD.categoria;
            const permitidoDesconto = dadosBD.permitidoDesconto;

            // Objeto limpo para o Excel e para o Card
            const produtoObj = {
                SKU: sku,
                Descricao: descBruto || 'Item Promocional',
                Saldo: saldo,
                Categoria: categoria,
                'Permitido Desconto/Brinde': permitidoDesconto
            };

            // Determinar badge de desconto
            let badgeDesconto = '';
            if (permitidoDesconto) {
                const textoLower = permitidoDesconto.toLowerCase();
                if (textoLower.includes('100%')) {
                    badgeDesconto = '<span class="badge-desconto desconto-100">100%</span>';
                } else if (textoLower.includes('50%')) {
                    badgeDesconto = '<span class="badge-desconto desconto-50">50%</span>';
                } else if (textoLower.includes('sim') || textoLower.includes('liberado')) {
                    badgeDesconto = '<span class="badge-desconto desconto-sim">Liberado</span>';
                }
            }

            // HTML Card
            const card = document.createElement('div');
            card.className = 'product-card';
            card.setAttribute('data-search', `${sku} ${produtoObj.Descricao}`.toLowerCase());
            card.setAttribute('data-categoria', categoria);
            card.setAttribute('data-desconto', permitidoDesconto.toLowerCase());

            card.innerHTML = `
                <div class="card-header-info">
                    <span class="badge-categoria">${categoria}</span>
                    ${badgeDesconto}
                </div>
                <div class="sku">SKU: ${sku}</div>
                <div class="desc">${produtoObj.Descricao}</div>
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

    if (matches === 0) {
        alert("Nenhum item do estoque bateu com a lista de promoções.");
    }
}

// 3. Funções de Pesquisa e Filtros
document.getElementById('searchInput').addEventListener('keyup', aplicarFiltros);
document.getElementById('filtroCategoria').addEventListener('change', aplicarFiltros);
document.getElementById('filtroDesconto').addEventListener('change', aplicarFiltros);

// 4. Funções de Exportação
function exportarExcel(dados, nomeArquivo) {
    if (dados.length === 0) {
        alert("Não há dados nesta unidade para exportar.");
        return;
    }
    
    // Cria uma nova planilha (Worksheet)
    const ws = XLSX.utils.json_to_sheet(dados);
    
    // Cria um novo arquivo (Workbook)
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Promoções");
    
    // Baixa o arquivo
    XLSX.writeFile(wb, nomeArquivo);
}

// Event Listeners dos Botões
document.getElementById('btn-export-13706').addEventListener('click', () => {
    exportarExcel(dadosPalmeira, "Promocoes_Palmeira_13706.xlsx");
});

document.getElementById('btn-export-13707').addEventListener('click', () => {
    exportarExcel(dadosPenedo, "Promocoes_Penedo_13707.xlsx");
});