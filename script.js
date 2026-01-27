// Variável para armazenar a lista de promoções carregada do JSON
let promocoesDB = [];

// 1. Carregar o arquivo JSON de promoções ao iniciar
fetch('./promocoes.json', { cache: 'no-store' })
    .then(response => response.json())
    .then(data => {
        promocoesDB = data;
        console.log("Banco de Promoções carregado:", promocoesDB.length, "itens.");
    })
    .catch(error => alert("Erro ao carregar promocoes.json. Verifique se o arquivo está na pasta."));

// 2. Escutar o upload do arquivo
document.getElementById('upload').addEventListener('change', handleFileSelect, false);

function handleFileSelect(evt) {
    const file = evt.target.files[0];
    if (!file) return;

    document.getElementById('loading').classList.remove('hidden');

    const reader = new FileReader();

    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});

        // Pega a primeira aba da planilha
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Converte para JSON
        const estoqueData = XLSX.utils.sheet_to_json(worksheet);

        processarDados(estoqueData);
    };

    reader.readAsArrayBuffer(file);
}

function processarDados(estoque) {
    // Limpar resultados anteriores
    document.getElementById('list-13706').innerHTML = '';
    document.getElementById('list-13707').innerHTML = '';
    document.getElementById('msg-13706').style.display = 'block';
    document.getElementById('msg-13707').style.display = 'block';

    // Normalizar lista de SKUs promocionais para busca rápida (Array de Strings)
    // Estamos assumindo que no JSON a chave é "Código Produto"
    const promoSKUs = promocoesDB.map(p => String(p['Código Produto']).trim());

    let count13706 = 0;
    let count13707 = 0;

    estoque.forEach(item => {
        // Normalização dos dados da linha do Excel
        // Verifica se as chaves existem (SheetJS usa as chaves exatamente como no cabeçalho do Excel)
        const skuEstoque = item['Produto'] ? String(item['Produto']).trim() : null;
        const saldo = parseFloat(item['Saldo Atual']);
        const quebra = String(item['Quebra']).trim(); // Converte para string para comparar "13706"

        // LÓGICA DE FILTRO:
        // 1. Tem SKU válido?
        // 2. O SKU existe na lista de promoções?
        // 3. O saldo é maior que 0?
        
        if (skuEstoque && promoSKUs.includes(skuEstoque) && saldo > 0) {
            
            // Criar o Card HTML
            const card = document.createElement('div');
            card.className = 'product-card';
            card.innerHTML = `
                <div class="sku">SKU: ${skuEstoque}</div>
                <div><strong>Item Promocional</strong></div>
                <div class="saldo">Saldo: ${saldo} un.</div>
            `;

            // Distribuir para a unidade correta
            if (quebra === '13706') {
                document.getElementById('list-13706').appendChild(card);
                count13706++;
                document.getElementById('msg-13706').style.display = 'none';
            } else if (quebra === '13707') {
                document.getElementById('list-13707').appendChild(card);
                count13707++;
                document.getElementById('msg-13707').style.display = 'none';
            }
        }
    });

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');
}