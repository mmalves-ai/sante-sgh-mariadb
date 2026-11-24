// Regras puras de estoque, almoxarifado e compras (M28): documento e consolidação, saída, destino e origem, lote e
// validade, competência, cotação, conferência da nota, escopo por local, inventário, ponto de pedido e alçada.
// Moram em @sgh/contratos (subcaminho `@sgh/contratos/regras-suprimentos`, fora do índice) porque o adaptador do legado
// também as confere antes de gravar e só depende de contratos (fronteira Nx; D-REGRAS-28); @sgh/dominio-suprimentos as
// publica para a API e a tela e as testa (cobertura no pacote do domínio).
export * from './recusa.js';
export * from './documento.js';
export * from './destino-origem.js';
export * from './saida.js';
export * from './lote.js';
export * from './competencia.js';
export * from './cotacao.js';
export * from './conferencia-nf.js';
export * from './escopo.js';
export * from './inventario.js';
export * from './ponto-pedido.js';
export * from './alcada.js';
// M29: farmácia hospitalar, dispensação e farmácia clínica (fila, política, controlados, entrega e devolução da dose,
// avaliação farmacêutica, situações, livro de controlados, farmácia ambulatorial com SNGPC e o código da etiqueta).
export * from './farmacia-situacao.js';
export * from './farmacia-fila.js';
export * from './farmacia-controlado.js';
export * from './farmacia-entrega.js';
export * from './farmacia-avaliacao.js';
export * from './farmacia-livro.js';
export * from './farmacia-sngpc.js';
export * from './farmacia-etiqueta.js';
// M41: onda 3 (farmácia depois da prescrição, motor de estoque do banco, efeitos por documento, documentos do dia por
// sistema, horários dispensados contra prescritos e conferência numérica).
export * from './onda3.js';
// M46 (etapa 3): OPME (solicitação ligada à agenda, etapas, consumo em sala com rastreio, devolução, conciliação com a
// conta e a leitura do código GS1 da embalagem).
export * from './opme.js';
// M46 (etapa 4): consignados (saldo, remessa, reposição, faturamento, devolução ao fornecedor, indicador) e manipulação
// (abertura do item validado, capela, sobra, dupla conferência e baixa).
export * from './consignado.js';
export * from './manipulacao.js';
// M55 (etapa 3): contrato com fornecedor (vigência e alertas, reajuste, saldo, vínculo e avaliação).
export * from './contrato.js';
// M55 (etapa 4): processo formal de compra (etapas, pesquisa de preços, prazos do aviso, julgamento, recurso e
// homologação com segregação de funções).
export * from './licitacao.js';
// Regra 10: o termo de referência, o registro da etapa e a ata em PDF/A (conteúdo; a emissão é do M09).
export * from './licitacao-documento.js';
// F3.6 (05-SUP linha 7): regra de integração prescrição × estoque e horários padrão de medicação.
export * from './farmacia-parametros.js';
// F3.6 (05-SUP linhas 1, 3 e 6): cadastro do item e do local, escopo do usuário e lista de separação.
export * from './cadastro-estoque.js';
// F3.6 (05-SUP linha 13): kit padrão (composição e vínculo ao procedimento).
export * from './kit-padrao.js';
// F3.6 (05-SUP linha 16): recálculo auditado do saldo e do custo médio pelo razão.
export * from './recalculo-saldo.js';
// F3.6 (05-SUP linha 28): vínculo do item com a referência de preço de material e medicamento (código, edição, fator).
export * from './vinculo-referencia-preco.js';
// F3.6 (05-SUP linha 14): etiqueta de identificação (DataMatrix GS1 e código linear) e leitura pelo padrão configurado.
export * from './identificacao-estoque.js';
