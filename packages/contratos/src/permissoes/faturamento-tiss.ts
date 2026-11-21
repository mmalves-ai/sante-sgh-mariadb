// Permissões do M31 (ficha, seção 7; convencoes.md §12): guias TISS, lotes e protocolo, prazos de envio, webservices por
// operadora, fechamento de competência, demonstrativos, retorno e glosa e o painel de glosas. Quem tem a opção no outro
// sistema tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem do Faturamento convênios (módulo 4)
// levantadas na primeira hora do marco (retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - Emissão de Contas 1132 (Conta TISS 1165, Gerar XML 1196);
//   - Controle de Remessa 6637 (Manutenção da Remessa 6638, Manutenção das Contas da Remessa 6643,
//     Fechamento/Apresentação da Remessa 6644); Alteração de Remessa 1600;
//   - Arquivos › TISS 1536 (Padrão 1537; Arquivo Remessa 4448, Reapresentação 4449, Retorno 4450, Recurso de Glosas
//     4451, Remessa Envio Lote Guias 4452);
//   - Demonstrativos 1378; Controle de Recebimento 1432;
//   - Glosas 1458 (Manutenção 1459, Manutenção por Intervalo 1460, Motivo/Reapres. 1461, Listagem 1462, Recurso de
//     Glosa 1472 e Guia de Recurso de Glosas TISS 4446, Relatórios 1476);
//   - Utilitários › Fechamento de Fatura 1590 (Fechamento 1591, Apresentação 1592), Fechamento Mensal 1593.
// O escopo por convênio (convênios liberados ao usuário) vale em toda leitura e gravação (como no M30). Supervisor do
// faturamento (protocolo, reabrir competência): Fechamento de Fatura (1591), Apresentação (1592) ou Fechamento Mensal
// (1593) (D-SUP-31).
import type { DeclaracaoPermissao } from './tipos.js';

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'financeira',
  criticidade: 'normal',
  escopos: ['convenio'],
  ...extra,
});

export const PERMISSOES_FATURAMENTO_M31: readonly DeclaracaoPermissao[] = [
  p('faturamento.guia.ler', 'Consultar as guias TISS das contas emitidas'),
  p('faturamento.guia.imprimir', 'Imprimir a guia TISS no leiaute oficial (PDF/A)'),
  p('faturamento.lote.ler', 'Consultar lotes TISS, contas do lote, XML guardado e prazos de envio'),
  p(
    'faturamento.lote.gerar',
    'Montar o lote TISS 04.03.00 (XML validado no XSD, numeração do contador)',

    {
      criticidade: 'sensivel',
    },
  ),
  p(
    'faturamento.lote.enviar',
    'Enviar o lote à operadora (só em produção; fora dela, o simulador)',

    {
      criticidade: 'sensivel',
    },
  ),
  p(
    'faturamento.protocolo.registrar',
    'Registrar ou limpar o protocolo do lote (congela o lote; supervisor)',

    { criticidade: 'sensivel' },
  ),
  p('faturamento.competencia.ler', 'Consultar as competências fechadas por convênio'),
  p('faturamento.competencia.fechar', 'Fechar a competência do convênio', {
    criticidade: 'sensivel',
  }),
  p(
    'faturamento.competencia.reabrir',
    'Reabrir a competência do convênio (supervisor, com motivo)',

    { criticidade: 'sensivel' },
  ),
  p('faturamento.demonstrativo.ler', 'Consultar demonstrativos e a conciliação item a item'),
  p('faturamento.demonstrativo.importar', 'Importar ou digitar o demonstrativo da operadora'),
  p('faturamento.glosa.ler', 'Consultar retorno, glosa, recurso e desfecho por conta e item'),
  p('faturamento.glosa.baixar', 'Baixar o retorno do item (valor e quantidade pagos, motivo da glosa)'),
  p('faturamento.glosa.decidir', 'Decidir a glosa: aceitar (motivo) ou recorrer (justificativa)'),
  p('faturamento.glosa.recorrer', 'Registrar o recurso de glosa do item', {
    criticidade: 'sensivel',
  }),
  p(
    'faturamento.glosa.registrarDesfecho',
    'Registrar o desfecho do recurso (acatado, parcial ou negado)',

    { criticidade: 'sensivel' },
  ),
  // O módulo de relatórios não tem escopo próprio (o painel filtra pelos convênios do escopo da sessão no servidor).
  p(
    'relatorio.glosa.ler',
    'Painel de glosas e ciclo de receita (só agregados)',

    { escopos: [] },
  ),
  p('relatorio.glosa.exportar', 'Exportar o painel de glosas', { escopos: [] }),
  p(
    'integracao.tiss.ler',
    'Consultar a configuração TISS e os webservices por operadora (sem credenciais)',

    { categoria: 'tecnica', escopos: [] },
  ),
  p(
    'integracao.tiss.editar',
    'Editar o endpoint TISS por operadora e transação (referência ao cofre)',

    { categoria: 'tecnica', criticidade: 'critica', escopos: [] },
  ),
];
