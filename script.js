// --- Funções Auxiliares ---

// Função inteligente para pegar valor ignorando maiúsculas/minúsculas e espaços
function obterValorFlexivel(linha, nomeColunaAlvo) {
    const chaves = Object.keys(linha);
    const chaveEncontrada = chaves.find(k => k.trim().toLowerCase() === nomeColunaAlvo.trim().toLowerCase());
    return chaveEncontrada ? linha[chaveEncontrada] : undefined;
}

let promoSKUs = [];

// 1. Carregar BD (Executa ao abrir a página)
window.addEventListener('DOMContentLoaded', () => {
    fetch('./bd.xlsx', { cache: 'no-store' })
        .then(response => {
            if (!response.ok) throw new Error("Erro ao buscar bd.xlsx");
            return response.arrayBuffer();
        })
        .then(data => {
            const workbook = XLSX.read(data, {type: 'array'});
            const sheetName = workbook.SheetNames[0];
            const jsonBD = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
            
            // Extrai SKUs normalizados
            promoSKUs = jsonBD.map(item => {
                let codigo = obterValorFlexivel(item, 'Código Produto');
                if (!codigo) codigo = obterValorFlexivel(item, 'Codigo Produto');
                return codigo ? String(codigo).trim() : null;
            }).filter(Boolean);
            
            document.getElementById('status-bd').textContent = `✅ Banco de dados carregado (${promoSKUs.length} produtos)`;
            console.log("BD Carregado com sucesso.");
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
        alert("Aguarde o carregamento do Banco de Dados ou verifique o arquivo bd.xlsx.");
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
    
    // Limpa listas anteriores
    list13706.innerHTML = '';
    list13707.innerHTML = '';
    
    let matches = 0;

    estoque.forEach(item => {
        // Busca Flexível das colunas
        const skuBruto = obterValorFlexivel(item, 'Produto');
        const saldoBruto = obterValorFlexivel(item, 'Saldo Atual');
        const quebraBruto = obterValorFlexivel(item, 'Quebra');
        const descBruto = obterValorFlexivel(item, 'Descricao') || obterValorFlexivel(item, 'Descrição');

        // Normalização
        const sku = skuBruto ? String(skuBruto).trim() : null;
        const saldo = parseFloat(saldoBruto);
        const quebra = quebraBruto ? String(quebraBruto).trim() : '';

        // Validação (SKU existe? Está no BD? Tem saldo?)
        if (sku && promoSKUs.includes(sku) && saldo > 0) {
            matches++;
            
            const card = document.createElement('div');
            card.className = 'product-card';
            // Adicionamos atributos data- para facilitar a pesquisa depois
            card.setAttribute('data-search', `${sku} ${descBruto}`.toLowerCase());
            
            card.innerHTML = `
                <div class="sku">SKU: ${sku}</div>
                <div class="desc">${descBruto || 'Item Promocional'}</div>
                <div class="saldo">Saldo: ${saldo}</div>
            `;

            if (quebra === '13706') {
                list13706.appendChild(card);
                document.getElementById('msg-13706').style.display = 'none';
            } else if (quebra === '13707') {
                list13707.appendChild(card);
                document.getElementById('msg-13707').style.display = 'none';
            }
        }
    });

    document.getElementById('results').classList.remove('hidden');

    if (matches === 0) {
        alert("Nenhum item do estoque bateu com a lista de promoções.");
    }
}

// 3. Função de Pesquisa (Filtro em Tempo Real)
document.getElementById('searchInput').addEventListener('keyup', function(e) {
    const termo = e.target.value.toLowerCase();
    const cards = document.querySelectorAll('.product-card');

    cards.forEach(card => {
        // Pega o texto que salvamos no atributo data-search
        const textoCard = card.getAttribute('data-search');
        
        if (textoCard.includes(termo)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
});