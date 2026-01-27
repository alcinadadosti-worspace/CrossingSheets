let promoSKUs = [];

// Carrega o BD
window.addEventListener('DOMContentLoaded', () => {
    console.log("Iniciando leitura do bd.xlsx...");
    fetch('./bd.xlsx', { cache: 'no-store' })
        .then(response => {
            if (!response.ok) throw new Error("Erro 404: bd.xlsx não encontrado");
            return response.arrayBuffer();
        })
        .then(data => {
            const workbook = XLSX.read(data, {type: 'array'});
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonBD = XLSX.utils.sheet_to_json(worksheet);
            
            // LOG DE DIAGNÓSTICO DO BD
            if (jsonBD.length > 0) {
                console.log("--- DIAGNÓSTICO BD ---");
                console.log("Colunas encontradas no BD:", Object.keys(jsonBD[0]));
                console.log("Exemplo da primeira linha do BD:", jsonBD[0]);
            }

            // Normaliza os SKUs para string e remove espaços
            promoSKUs = jsonBD.map(item => {
                // Tenta pegar 'Código Produto', se não achar, avisa
                const codigo = item['Código Produto'];
                if (codigo === undefined) {
                    console.warn("AVISO: Coluna 'Código Produto' não encontrada numa linha do BD. Verifique os nomes das colunas.");
                    return null;
                }
                return String(codigo).trim();
            }).filter(Boolean); // Remove nulos
            
            console.log(`BD Carregado com Sucesso! ${promoSKUs.length} SKUs prontos para cruzar.`);
            console.log("Alguns SKUs do BD:", promoSKUs.slice(0, 3)); // Mostra os 3 primeiros para conferir
        })
        .catch(error => alert("Erro no BD: " + error.message));
});

document.getElementById('upload').addEventListener('change', handleFileSelect, false);

function handleFileSelect(evt) {
    const file = evt.target.files[0];
    if (!file) return;

    console.log("Arquivo de estoque selecionado:", file.name);
    const reader = new FileReader();

    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const estoqueData = XLSX.utils.sheet_to_json(worksheet);

        processarDados(estoqueData);
    };
    reader.readAsArrayBuffer(file);
}

function processarDados(estoque) {
    // Limpeza da tela
    document.getElementById('list-13706').innerHTML = '';
    document.getElementById('list-13707').innerHTML = '';
    
    if (estoque.length === 0) {
        alert("A planilha importada parece estar vazia.");
        return;
    }

    // LOG DE DIAGNÓSTICO DO UPLOAD
    console.log("--- DIAGNÓSTICO ESTOQUE ---");
    console.log("Total de linhas no estoque:", estoque.length);
    console.log("Colunas encontradas no Estoque:", Object.keys(estoque[0]));
    console.log("Exemplo da primeira linha do Estoque:", estoque[0]);

    let matches = 0;

    estoque.forEach((item, index) => {
        // Pega os valores brutos para testar
        const skuBruto = item['Produto'];
        const saldoBruto = item['Saldo Atual'];
        const quebraBruto = item['Quebra'];

        // Normalização
        const skuEstoque = skuBruto ? String(skuBruto).trim() : null;
        const saldo = parseFloat(saldoBruto);
        const quebra = String(quebraBruto).trim();

        // LOG DETALHADO PARA AS PRIMEIRAS 5 LINHAS (Para não poluir muito)
        if (index < 5) {
            console.log(`Linha ${index+1}: SKU="${skuEstoque}" | Saldo=${saldo} | Quebra="${quebra}"`);
            const existeNoBD = promoSKUs.includes(skuEstoque);
            console.log(`-> Existe no BD? ${existeNoBD ? 'SIM' : 'NÃO'} | Saldo > 0? ${saldo > 0 ? 'SIM' : 'NÃO'}`);
        }

        if (skuEstoque && promoSKUs.includes(skuEstoque) && saldo > 0) {
            matches++;
            const card = document.createElement('div');
            card.className = 'product-card';
            
            // Tenta achar descrição (Case sensitive)
            const descricao = item['Descricao'] || item['Descrição'] || "Item Promocional";

            card.innerHTML = `
                <div class="sku">SKU: ${skuEstoque}</div>
                <div style="font-size: 0.9rem; margin: 5px 0;">${descricao}</div>
                <div class="saldo">Saldo: ${saldo}</div>
            `;

            if (quebra === '13706') {
                document.getElementById('list-13706').appendChild(card);
                document.getElementById('msg-13706').style.display = 'none';
            } else if (quebra === '13707') {
                document.getElementById('list-13707').appendChild(card);
                document.getElementById('msg-13707').style.display = 'none';
            }
        }
    });

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');
    
    if (matches === 0) {
        alert("Processamento concluído, mas NENHUM match foi encontrado. Abra o Console (F12) para ver o diagnóstico.");
    }
}