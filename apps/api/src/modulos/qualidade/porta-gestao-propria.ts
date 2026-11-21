// Porta PRÓPRIA da gestão da qualidade (M48, etapa 5, e a revisão de prontuários do W0-04) sobre o MariaDB do cliente,
// pelo @sgh/nucleo. Lê o relógio e os feriados do estabelecimento e confere se a notificação de incidente existe
// (notificacao_incidente). Os documentos (documento_qualidade e _versao, _aprovacao, _ciencia), a análise crítica de
// indicadores, as auditorias, as comissões e reuniões, os riscos, as não conformidades, a ouvidoria, os envios
// regulatórios e a revisão de prontuários (sorteio_revisao_prontuario, revisao_prontuario, pendencia_prontuario)
// aguardam o mapeamento (pedido em docs/obra/fatias/f22/saida/04-03.json): até lá as leituras falham fechadas (503 `modelo-pendente`, a tela mostra indisponível) e as
// gravações recusam com `modelo-pendente` (nada é gravado pela metade; a tela fica em consulta).
import { type NucleoQualidade, feriadosDoEstabelecimento, lerNoEstabelecimento, leituraPendente, liberacaoPendente, modeloPendente, relogioDoEstabelecimento } from './apoio-propria.js';
import type { ContextoGestao, PortaGestao } from './porta-gestao.js';

const RECURSO = 'A gestão da qualidade (documentos, indicadores, auditorias, comissões, riscos, não conformidades, ouvidoria, envios e revisão de prontuários)';

export class PortaGestaoPropria implements PortaGestao {
  readonly destino = 'banco' as const;

  constructor(private readonly nucleo: NucleoQualidade) {}

  readonly podeGravar: PortaGestao['podeGravar'] = () => Promise.resolve(liberacaoPendente(RECURSO));

  readonly executar: PortaGestao['executar'] = (_c, op) => Promise.reject(modeloPendente(`${RECURSO} (operação ${op})`));

  readonly gravarSgh: PortaGestao['gravarSgh'] = () => Promise.reject(modeloPendente(RECURSO));

  relogio(c: ContextoGestao) {
    return lerNoEstabelecimento(this.nucleo, c, (l, est) => relogioDoEstabelecimento(l, est));
  }

  feriados(c: ContextoGestao, de: string, ate: string) {
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) =>
      (await feriadosDoEstabelecimento(l, est, de, ate)).map((f) => ({ data: f.data })),
    );
  }

  notificacaoExiste(c: ContextoGestao, id: number) {
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) =>
      Boolean(
        await l.uma(
          'SELECT id FROM notificacao_incidente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [id, est],
        ),
      ),
    );
  }

  // ── Leituras que aguardam o mapeamento: falham fechadas (503 `modelo-pendente`), nunca vazio nem zero ──

  nomesPacientes(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  documentos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  documento(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  documentosDoCodigo(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  ciencias(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  cientes(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  analises(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  historicoAnalises(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  auditorias(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  auditoria(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  naoConformidadesPorOrigem(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  comissoes(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  comissao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  reunioes(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  riscos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  risco(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  naoConformidades(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  naoConformidade(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  manifestacoes(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  manifestacao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  pesquisas(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  pesquisa(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  contagem(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  envios(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  envio(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  incidentesNotivisa(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  reuniao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  versoes(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  dependentes(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  notificacoesPorTipo(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  protocolosGerenciados(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  checklistsRevisao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  checklistRevisao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  altasParaRevisao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  loginsDosMedicos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  sorteiosRevisao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  sorteioRevisao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  prontuariosDoSorteio(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  prontuarioRevisao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  pendenciasDosProntuarios(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  pendenciaRevisao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  pendenciasDoLogin(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  revisoesDaCompetencia(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  revisoesDaInternacao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }
}
