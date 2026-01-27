// --- Funções Auxiliares ---
function obterValorFlexivel(linha, nomeColunaAlvo) {
    const chaves = Object.keys(linha);
    const chaveEncontrada = chaves.find(k => k.trim().toLowerCase() === nomeColunaAlvo.trim().toLowerCase());
    return chaveEncontrada ? linha[chaveEncontrada] : undefined;
}

let promoSKUs = [];
// Arrays para armazenar os dados prontos para exportação
let dadosPalmeira = [];
let dadosPenedo = [];

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
            
            promoSKUs = jsonBD.map(item => {
                let codigo = obterValorFlexivel(item, 'Código Produto');
                if (!codigo) codigo = obterValorFlexivel(item, 'Codigo Produto');
                return codigo ? String(codigo).trim() : null;
            }).filter(Boolean);
            
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
            
            // Objeto limpo para o Excel e para o Card
            const produtoObj = {
                SKU: sku,
                Descricao: descBruto || 'Item Promocional',
                Saldo: saldo
            };

            // HTML Card
            const card = document.createElement('div');
            card.className = 'product-card';
            card.setAttribute('data-search', `${sku} ${produtoObj.Descricao}`.toLowerCase());
            
            card.innerHTML = `
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

// 3. Função de Pesquisa
document.getElementById('searchInput').addEventListener('keyup', function(e) {
    const termo = e.target.value.toLowerCase();
    const cards = document.querySelectorAll('.product-card');

    cards.forEach(card => {
        const textoCard = card.getAttribute('data-search');
        card.style.display = textoCard.includes(termo) ? 'block' : 'none';
    });
});

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