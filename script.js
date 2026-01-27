// Variável global para armazenar a lista de SKUs promocionais
let promoSKUs = [];

// 1. Carregar a planilha "BD" (bd.xlsx) que está na raiz do projeto
// Isso acontece assim que a página abre
window.addEventListener('DOMContentLoaded', () => {
    fetch('./bd.xlsx')
        .then(response => {
            if (!response.ok) {
                throw new Error("Não foi possível encontrar o arquivo bd.xlsx");
            }
            return response.arrayBuffer();
        })
        .then(data => {
            const workbook = XLSX.read(data, {type: 'array'});
            
            // Assume que os dados estão na primeira aba
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Converte a aba em JSON
            const jsonBD = XLSX.utils.sheet_to_json(worksheet);
            
            // Extrai apenas os códigos (SKUs) para um array simples para facilitar a busca
            // Certifique-se que o nome da coluna no Excel é "Código Produto"
            promoSKUs = jsonBD.map(item => String(item['Código Produto']).trim());
            
            console.log("Base de Promoções carregada via bd.xlsx:", promoSKUs.length, "itens.");
        })
        .catch(error => {
            console.error(error);
            alert("Erro: Não foi possível carregar o arquivo 'bd.xlsx' da raiz. Verifique se o nome está correto.");
        });
});

// 2. Escutar o upload do arquivo de ESTOQUE do usuário
document.getElementById('upload').addEventListener('change', handleFileSelect, false);

function handleFileSelect(evt) {
    const file = evt.target.files[0];
    if (!file) return;

    // Verifica se a base de dados já foi carregada
    if (promoSKUs.length === 0) {
        alert("Atenção: A base de promoções (bd.xlsx) ainda não foi carregada ou está vazia.");
        return;
    }

    document.getElementById('loading').classList.remove('hidden');

    const reader = new FileReader();

    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});

        // Pega a primeira aba da planilha de estoque
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
    const list13706 = document.getElementById('list-13706');
    const list13707 = document.getElementById('list-13707');
    
    list13706.innerHTML = '';
    list13707.innerHTML = '';
    
    document.getElementById('msg-13706').style.display = 'block';
    document.getElementById('msg-13707').style.display = 'block';

    let count13706 = 0;
    let count13707 = 0;

    estoque.forEach(item => {
        // Normalização dos dados da linha do Excel de Estoque
        // Ajuste aqui se os nomes das colunas mudarem
        const skuEstoque = item['Produto'] ? String(item['Produto']).trim() : null;
        const saldo = parseFloat(item['Saldo Atual']);
        const quebra = String(item['Quebra']).trim(); 

        // LÓGICA DE FILTRO:
        // 1. Tem SKU válido na linha do estoque?
        // 2. O SKU do estoque existe dentro da lista carregada do bd.xlsx?
        // 3. O saldo é maior que 0?
        
        if (skuEstoque && promoSKUs.includes(skuEstoque) && saldo > 0) {
            
            // Criar o Card HTML
            const card = document.createElement('div');
            card.className = 'product-card';
            
            // Tenta pegar a descrição se ela existir na linha do estoque, senão deixa genérico
            const descricao = item['Descricao'] || item['Descrição'] || "Item Promocional";

            card.innerHTML = `
                <div class="sku">SKU: ${skuEstoque}</div>
                <div style="font-size: 0.9rem; margin: 5px 0;">${descricao}</div>
                <div class="saldo">Saldo: ${saldo} un.</div>
            `;

            // Distribuir para a unidade correta
            if (quebra === '13706') {
                list13706.appendChild(card);
                count13706++;
                document.getElementById('msg-13706').style.display = 'none';
            } else if (quebra === '13707') {
                list13707.appendChild(card);
                count13707++;
                document.getElementById('msg-13707').style.display = 'none';
            }
        }
    });

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');
    
    // Feedback final (opcional)
    console.log(`Processamento concluído: ${count13706} itens em Palmeira, ${count13707} itens em Penedo.`);
}