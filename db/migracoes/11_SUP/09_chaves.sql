-- SUP, lote 09 (F4 conector, rodada 6: pedido r5b_parametros_estoque da fatia L7-08, decisão em
-- docs/obra/passagens/F4-decisoes-destino.md). Só para frente. Sem tabela nova (não há 09_tabelas.sql).
-- Catálogo tipado das opções do estoque (parametro_definicao, chave estoque.<nome>): valem para o cliente, o
-- estabelecimento e o usuário (a origem guardava uma ficha de opções por usuário). Marcação: booleano sim/nao.
-- Idempotente (chave única).
INSERT INTO modulo_sistema (codigo, descricao, ativo, ordem, criado_em)
  SELECT 'estoque', 'Estoque', TRUE, 0, CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'estoque');
INSERT IGNORE INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, permite_rede, permite_estabelecimento, permite_unidade, permite_perfil, permite_usuario, critico, obrigatorio, area_dona, fundamento, ativo, criado_em)
  SELECT x.chave, m.id, x.descricao, x.tipo, TRUE, TRUE, FALSE, FALSE, TRUE, FALSE, FALSE, 'estoque', 'Continuidade das opções do estoque por usuário trazidas da implantação', TRUE, CURRENT_TIMESTAMP(3)
  FROM (
    SELECT 'estoque.nomeEmpresaCabecalho' AS chave, 'Nome empresa cabecalho' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.enderecoCabecalho' AS chave, 'Endereco cabecalho' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.cidadeCabecalho' AS chave, 'Cidade cabecalho' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.telefoneCabecalho' AS chave, 'Telefone cabecalho' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.cepCabecalho' AS chave, 'Cep cabecalho' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.impressaoConfirmada' AS chave, 'Impressao confirmada (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.ufCabecalho' AS chave, 'Uf cabecalho' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.mesProcessamento' AS chave, 'Mes processamento' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.anoProcessamento' AS chave, 'Ano processamento' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.geraDemonstrativoMensal' AS chave, 'Gera demonstrativo mensal (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaDocumento' AS chave, 'Digita documento (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.armazenaPorUnidade' AS chave, 'Armazena por unidade (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.controlaDataValidade' AS chave, 'Controla data validade (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaMedico' AS chave, 'Informa medico (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consisteQuantidade' AS chave, 'Consiste quantidade (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.valorizaSaida' AS chave, 'Valoriza saida (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaHorarioMedicacao' AS chave, 'Informa horario medicacao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaVencimentoNota' AS chave, 'Informa vencimento nota (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consumoAutomatico' AS chave, 'Consumo automatico (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.serieDocumento' AS chave, 'Serie documento' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.usaCodigoBarras' AS chave, 'Usa codigo barras (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consisteEstoqueMinimo' AS chave, 'Consiste estoque minimo (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.geraDocumentos' AS chave, 'Gera documentos (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaViaAdministracao' AS chave, 'Digita via administracao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.valorizaDevolucao' AS chave, 'Valoriza devolucao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.valorizaRequisicao' AS chave, 'Valoriza requisicao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.valorizaVendaExterna' AS chave, 'Valoriza venda externa (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.itemValorizado' AS chave, 'Item valorizado (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.percentualCompra' AS chave, 'Percentual compra' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.codigoBarrasNaTransferencia' AS chave, 'Codigo barras na transferencia (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.codigoBarrasNaDevolucao' AS chave, 'Codigo barras na devolucao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.transferePorCodigoBarras' AS chave, 'Transfere por codigo barras (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.valorizaVendaExternaTerceiros' AS chave, 'Valoriza venda externa terceiros (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.percentualVendaExternaFaturada' AS chave, 'Percentual venda externa faturada' AS descricao, 'decimal' AS tipo
    UNION ALL SELECT 'estoque.percentualVendaExternaTerceiros' AS chave, 'Percentual venda externa terceiros' AS descricao, 'decimal' AS tipo
    UNION ALL SELECT 'estoque.atualizaFaturamento' AS chave, 'Atualiza faturamento (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.gravacaoAdicional' AS chave, 'Gravacao adicional (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.devolucaoPacienteCentroCusto' AS chave, 'Devolucao paciente centro custo (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaRegistroConselho' AS chave, 'Digita registro conselho (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaTransportadora' AS chave, 'Digita transportadora (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaConhecimentoTransporte' AS chave, 'Digita conhecimento transporte (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.emiteNotaFiscal' AS chave, 'Emite nota fiscal (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.exigePedidoNaNota' AS chave, 'Exige pedido na nota (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.formularioEntrada' AS chave, 'Formulario entrada' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.formularioSaida' AS chave, 'Formulario saida' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.formularioDevolucao' AS chave, 'Formulario devolucao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.formularioRequisicao' AS chave, 'Formulario requisicao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.sequenciaRelatorioControlado' AS chave, 'Sequencia relatorio controlado' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.requisicaoPorHorario' AS chave, 'Requisicao por horario (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.pesquisaItem' AS chave, 'Pesquisa item (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaMarca' AS chave, 'Digita marca (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.exibeMaterialMedicamentoLista' AS chave, 'Exibe material medicamento lista (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.modeloEtiquetaDose' AS chave, 'Modelo etiqueta dose' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.hospitalPadrao' AS chave, 'Hospital padrao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.dataEstoqueInicial' AS chave, 'Data estoque inicial' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.periodoInicioEntrada' AS chave, 'Periodo inicio entrada' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.periodoFimEntrada' AS chave, 'Periodo fim entrada' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.periodoInicioSaida' AS chave, 'Periodo inicio saida' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.periodoFimSaida' AS chave, 'Periodo fim saida' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.periodoInicioDevolucao' AS chave, 'Periodo inicio devolucao' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.periodoFimDevolucao' AS chave, 'Periodo fim devolucao' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.periodoInicioTransferencia' AS chave, 'Periodo inicio transferencia' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.periodoFimTransferencia' AS chave, 'Periodo fim transferencia' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.valorizaTransferencia' AS chave, 'Valoriza transferencia (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.centroCustoIntegrado' AS chave, 'Centro custo integrado (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.periodoInicioPedido' AS chave, 'Periodo inicio pedido' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.periodoFimPedido' AS chave, 'Periodo fim pedido' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.digitaLaboratorio' AS chave, 'Digita laboratorio (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consisteOrcamento' AS chave, 'Consiste orcamento (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.saidaComDevolucao' AS chave, 'Saida com devolucao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.momentoEscolhaLote' AS chave, 'Momento escolha lote' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'estoque.indicadorAtualizacaoFaturamento' AS chave, 'Indicador atualizacao faturamento' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'estoque.caminhoArquivos' AS chave, 'Caminho arquivos' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.caminhoImportacao' AS chave, 'Caminho importacao' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.destinoNotaFiscal' AS chave, 'Destino nota fiscal' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'estoque.responsavelTecnico' AS chave, 'Responsavel tecnico' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.compraTelefone' AS chave, 'Compra telefone' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.compraFax' AS chave, 'Compra fax' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.compraEmail' AS chave, 'Compra email' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.compraPresidente' AS chave, 'Compra presidente' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.compraEncarregado' AS chave, 'Compra encarregado' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.diasPesquisaVendaExterna' AS chave, 'Dias pesquisa venda externa' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.compraServidorEmail' AS chave, 'Compra servidor email' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.compraUsuarioEmail' AS chave, 'Compra usuario email' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.fatorConversaoEntrada' AS chave, 'Fator conversao entrada (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.alertaVencimentoGestao' AS chave, 'Alerta vencimento gestao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.visualizacaoRequisicao' AS chave, 'Visualizacao requisicao' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'estoque.ordemRequisicao' AS chave, 'Ordem requisicao' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'estoque.compraRamal' AS chave, 'Compra ramal' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.validaDevolucao' AS chave, 'Valida devolucao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.modeloPedido' AS chave, 'Modelo pedido' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.requisicaoSemQuantidade' AS chave, 'Requisicao sem quantidade (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.avisoPedido' AS chave, 'Aviso pedido (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaFontePagadora' AS chave, 'Informa fonte pagadora (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaEmpenho' AS chave, 'Informa empenho (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaFinalidadeObjeto' AS chave, 'Informa finalidade objeto (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaRegistroSanitario' AS chave, 'Informa registro sanitario (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaMarca' AS chave, 'Informa marca (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaSetor' AS chave, 'Informa setor (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaRequisitante' AS chave, 'Informa requisitante (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaSolicitante' AS chave, 'Informa solicitante (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.motivoInclusaoRequisicao' AS chave, 'Motivo inclusao requisicao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.observacaoCondicaoPagamento' AS chave, 'Observacao condicao pagamento (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.integraFinanceiro' AS chave, 'Integra financeiro (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.integraContabilidade' AS chave, 'Integra contabilidade (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.rastreiaItem' AS chave, 'Rastreia item (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.lancamentoAVista' AS chave, 'Lancamento a vista (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.historicoPadraoContabil' AS chave, 'Historico padrao contabil' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.centroCustoCredito' AS chave, 'Centro custo credito' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.centroCustoDebito' AS chave, 'Centro custo debito' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.imprimeAutorizacaoPagamento' AS chave, 'Imprime autorizacao pagamento (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.periodoConferenciaRequisicao' AS chave, 'Periodo conferencia requisicao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.informaNaturezaOperacao' AS chave, 'Informa natureza operacao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consisteDocumentoAnteriorVendaExterna' AS chave, 'Consiste documento anterior venda externa (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.diasPesquisaConsumo' AS chave, 'Dias pesquisa consumo' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.vencimentoAnteriorEmissao' AS chave, 'Vencimento anterior emissao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.observacaoTransferencia' AS chave, 'Observacao transferencia' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.visualizaQuantidadeValorRequisicao' AS chave, 'Visualiza quantidade valor requisicao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.gravaMesRequisicao' AS chave, 'Grava mes requisicao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.anoSaldo' AS chave, 'Ano saldo' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.mesSaldo' AS chave, 'Mes saldo' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.linhasRequisicao' AS chave, 'Linhas requisicao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.digitaFatorPedido' AS chave, 'Digita fator pedido (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.incluiFornecedorCompra' AS chave, 'Inclui fornecedor compra (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.separaControladoRequisicao' AS chave, 'Separa controlado requisicao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.cotacaoPrazoEntrega' AS chave, 'Cotacao prazo entrega (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.cotacaoValorFrete' AS chave, 'Cotacao valor frete (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.cotacaoValorMinimo' AS chave, 'Cotacao valor minimo (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaFatorNecessidade' AS chave, 'Digita fator necessidade (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.contabilizaProvisaoNota' AS chave, 'Contabiliza provisao nota (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.unidadeGestora' AS chave, 'Unidade gestora' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.inicioGestaoResponsavel' AS chave, 'Inicio gestao responsavel' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.inicioGestaoRatificador' AS chave, 'Inicio gestao ratificador' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'estoque.informaRegimeExecucao' AS chave, 'Informa regime execucao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaTipoResponsavel' AS chave, 'Informa tipo responsavel (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaTipoDispensa' AS chave, 'Informa tipo dispensa (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.cpfResponsavelGestao' AS chave, 'Cpf responsavel gestao' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.cpfRatificador' AS chave, 'Cpf ratificador' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.incluiTipoDocumentoCompra' AS chave, 'Inclui tipo documento compra (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.incluiSerieCompra' AS chave, 'Inclui serie compra (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.imprimeNumeroPedidoEntrada' AS chave, 'Imprime numero pedido entrada (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.imprimeVencimentoNota' AS chave, 'Imprime vencimento nota (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.lancaContabilidadeEmissao' AS chave, 'Lanca contabilidade emissao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.periodoDistribuicaoMaterialMedicamento' AS chave, 'Periodo distribuicao material medicamento' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.visualizaRetornoDistribuicao' AS chave, 'Visualiza retorno distribuicao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consisteGestaoSuprimento' AS chave, 'Consiste gestao suprimento (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.integraProntuario' AS chave, 'Integra prontuario (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consisteDocumentoFornecedor' AS chave, 'Consiste documento fornecedor (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.geraRegistroPreco' AS chave, 'Gera registro preco (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consultaRegistroPrecoTodosFornecedores' AS chave, 'Consulta registro preco todos fornecedores (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.linhasEntrada' AS chave, 'Linhas entrada' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.verificaPrincipioAtivo' AS chave, 'Verifica principio ativo (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.numeroVias' AS chave, 'Numero vias' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.cotacaoResponsavel' AS chave, 'Cotacao responsavel (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.cotacaoDocumento' AS chave, 'Cotacao documento (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.cotacaoDocumentoVencido' AS chave, 'Cotacao documento vencido (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaNumeroProcesso' AS chave, 'Informa numero processo (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.listaDocumentoVencido' AS chave, 'Lista documento vencido (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.copiaSetorCompra' AS chave, 'Copia setor compra (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaFinanceiroPedido' AS chave, 'Informa financeiro pedido (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.informaFinanceiroLicitacao' AS chave, 'Informa financeiro licitacao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.linhasDevolucao' AS chave, 'Linhas devolucao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.linhasTransferencia' AS chave, 'Linhas transferencia' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.quantidadeDiferentePedido' AS chave, 'Quantidade diferente pedido (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.imprimeObservacaoRequisicaoEntrada' AS chave, 'Imprime observacao requisicao entrada (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.integraSaidaContabilidade' AS chave, 'Integra saida contabilidade (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.integraSaidaCustos' AS chave, 'Integra saida custos (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.historicoPadraoSaida' AS chave, 'Historico padrao saida' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.registroConselhoControlado' AS chave, 'Registro conselho controlado (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.loteValidadeSaidaDevolucao' AS chave, 'Lote validade saida devolucao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.farmaceuticoResponsavel' AS chave, 'Farmaceutico responsavel' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.saldoReferencia' AS chave, 'Saldo referencia' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeDigitacaoEstoqueInicial' AS chave, 'Unidade digitacao estoque inicial' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeVisualizacaoEstoqueInicial' AS chave, 'Unidade visualizacao estoque inicial' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeDigitacaoInventario' AS chave, 'Unidade digitacao inventario' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeVisualizacaoInventario' AS chave, 'Unidade visualizacao inventario' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeDigitacaoMovimentoPaciente' AS chave, 'Unidade digitacao movimento paciente' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeVisualizacaoMovimentoPaciente' AS chave, 'Unidade visualizacao movimento paciente' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeDigitacaoMovimentoCentroCusto' AS chave, 'Unidade digitacao movimento centro custo' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeVisualizacaoMovimentoCentroCusto' AS chave, 'Unidade visualizacao movimento centro custo' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeDigitacaoTransferencia' AS chave, 'Unidade digitacao transferencia' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeVisualizacaoTransferencia' AS chave, 'Unidade visualizacao transferencia' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeDigitacaoCompra' AS chave, 'Unidade digitacao compra' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeVisualizacaoCompra' AS chave, 'Unidade visualizacao compra' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeDigitacaoEntrada' AS chave, 'Unidade digitacao entrada' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeVisualizacaoEntrada' AS chave, 'Unidade visualizacao entrada' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.permiteAntimicrobianoSuperior' AS chave, 'Permite antimicrobiano superior (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.justificaAntimicrobianoSuperior' AS chave, 'Justifica antimicrobiano superior (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.codigoBarrasInventario' AS chave, 'Codigo barras inventario (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.loteValidadeTransferencia' AS chave, 'Lote validade transferencia' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.sugereLoteValidadeAutomatico' AS chave, 'Sugere lote validade automatico (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consisteDispensacaoHorario' AS chave, 'Consiste dispensacao horario (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.sugereTransferenciaDispensacaoHorario' AS chave, 'Sugere transferencia dispensacao horario (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.sugereLoteDispensacaoHorario' AS chave, 'Sugere lote dispensacao horario (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.tempoAtualizacaoListaManipulacao' AS chave, 'Tempo atualizacao lista manipulacao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.tempoManipulacao' AS chave, 'Tempo manipulacao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.rastreiaLote' AS chave, 'Rastreia lote (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaConselhoLancamentoPacienteAnterior' AS chave, 'Digita conselho lancamento paciente anterior (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.geraSaidaComplementarDispensacaoHorario' AS chave, 'Gera saida complementar dispensacao horario (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.exigePrazoEntrega' AS chave, 'Exige prazo entrega (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consisteDataPosteriorPrimeiraDose' AS chave, 'Consiste data posterior primeira dose (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consisteDataAtualEntreDoses' AS chave, 'Consiste data atual entre doses (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.descontaTabelaKits' AS chave, 'Desconta tabela kits (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.farmaceuticoResponsavelManipulacao' AS chave, 'Farmaceutico responsavel manipulacao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.precoMaximoObrigatorio' AS chave, 'Preco maximo obrigatorio (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.inicioRastreabilidade' AS chave, 'Inicio rastreabilidade' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.unidadeVisualizacaoCadastroItem' AS chave, 'Unidade visualizacao cadastro item' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.codigoBarrasEstoqueInicial' AS chave, 'Codigo barras estoque inicial (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.unidadeDigitacaoCadastroItem' AS chave, 'Unidade digitacao cadastro item' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.integraFreteNaoInclusoContabilidade' AS chave, 'Integra frete nao incluso contabilidade (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.localManipulacao' AS chave, 'Local manipulacao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.informaCodigoCompraPublica' AS chave, 'Informa codigo compra publica (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.geraTransferenciaManipulacao' AS chave, 'Gera transferencia manipulacao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.unidadeVisualizacaoVendaExterna' AS chave, 'Unidade visualizacao venda externa' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.unidadeDigitacaoVendaExterna' AS chave, 'Unidade digitacao venda externa' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.programacaoEntrega' AS chave, 'Programacao entrega (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaQuantidadeEntrada' AS chave, 'Digita quantidade entrada (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.integraDataEntrada' AS chave, 'Integra data entrada (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.alertaSemEstoque' AS chave, 'Alerta sem estoque (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.numeroPedidoPorItem' AS chave, 'Numero pedido por item (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.tipoIntegracaoContabil' AS chave, 'Tipo integracao contabil' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.pedidoObrigatorioNota' AS chave, 'Pedido obrigatorio nota (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaCfopNota' AS chave, 'Digita cfop nota (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaCfopItemNota' AS chave, 'Digita cfop item nota (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.lancaItemSimilar' AS chave, 'Lanca item similar (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.exibePacienteEntradaConsignado' AS chave, 'Exibe paciente entrada consignado (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaCentroCustoNecessidade' AS chave, 'Digita centro custo necessidade (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaCentroCustoPedido' AS chave, 'Digita centro custo pedido (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.permiteSaidaKitRastreado' AS chave, 'Permite saida kit rastreado (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.usaAutorizacaoPedido' AS chave, 'Usa autorizacao pedido (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.geraPedidoOpmeSaida' AS chave, 'Gera pedido opme saida (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.enviaEmailPedidoCompra' AS chave, 'Envia email pedido compra (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaContratoVendaExterna' AS chave, 'Digita contrato venda externa (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.incluiEmissaoComplementoContabil' AS chave, 'Inclui emissao complemento contabil (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.integraApoioCotacao' AS chave, 'Integra apoio cotacao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.integraFreteNaoInclusoFinanceiro' AS chave, 'Integra frete nao incluso financeiro' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.farmaceuticoResponsavelGeral' AS chave, 'Farmaceutico responsavel geral (id do cadastro de inscrição no conselho)' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.permiteAlterarItemRequisicaoSaida' AS chave, 'Permite alterar item requisicao saida (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.gravaQuantidadeFatorConversao' AS chave, 'Grava quantidade fator conversao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.codigoBarrasRequisicao' AS chave, 'Codigo barras requisicao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.controlaConsignadoOpme' AS chave, 'Controla consignado opme (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.tipoEmissaoDispensacao' AS chave, 'Tipo emissao dispensacao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.responsavelManipulacaoAnterior' AS chave, 'Responsavel manipulacao anterior (id do cadastro de inscrição no conselho)' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.cargoCompra' AS chave, 'Cargo compra' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.buscaQuantidadeCodigoBarras' AS chave, 'Busca quantidade codigo barras (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.permiteDispensacaoExternaMais24h' AS chave, 'Permite dispensacao externa mais24h (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.integraDescontoNota' AS chave, 'Integra desconto nota (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaEnvioEmailPedido' AS chave, 'Digita envio email pedido (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.integraNotaDoacao' AS chave, 'Integra nota doacao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.digitaLaboratorioEntrada' AS chave, 'Digita laboratorio entrada' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.controlaSaidaProfilatico' AS chave, 'Controla saida profilatico (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.permiteEntradaQuantidadeDiferente' AS chave, 'Permite entrada quantidade diferente (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.enderecoServicoCotacao' AS chave, 'Endereco servico cotacao' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.leitorCodigoBarrasDispensacao' AS chave, 'Leitor codigo barras dispensacao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.relatorioOrdemCompra' AS chave, 'Relatorio ordem compra (id do cadastro de relatório)' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.anexaQuantidadeCodigoBarras' AS chave, 'Anexa quantidade codigo barras (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.mantenedoraIntegracaoCusto' AS chave, 'Mantenedora integracao custo (id do cadastro de mantenedora)' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.observacaoAcertoObrigatoria' AS chave, 'Observacao acerto obrigatoria (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.emailSituacaoPedido' AS chave, 'Email situacao pedido (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.contaContabilDesconto' AS chave, 'Conta contabil desconto' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.anexaQuantidadeTotalLote' AS chave, 'Anexa quantidade total lote (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.motivoExclusaoItemSaida' AS chave, 'Motivo exclusao item saida (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.servicoControleBloqueio' AS chave, 'Servico controle bloqueio' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'estoque.substituiItemPrescrito' AS chave, 'Substitui item prescrito (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.lancaItemNaoPrescrito' AS chave, 'Lanca item nao prescrito' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.nomeComercialLote' AS chave, 'Nome comercial lote' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.justificaSubstituicao' AS chave, 'Justifica substituicao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.justificaItemNaoPrescrito' AS chave, 'Justifica item nao prescrito' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'estoque.loteConsignadoRequisicao' AS chave, 'Lote consignado requisicao (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.usaCodigoBidimensional' AS chave, 'Usa codigo bidimensional (sim/nao)' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'estoque.consisteQuantidadePrescritaDispensada' AS chave, 'Consiste quantidade prescrita dispensada' AS descricao, 'inteiro' AS tipo
  ) x JOIN modulo_sistema m ON m.codigo = 'estoque';
