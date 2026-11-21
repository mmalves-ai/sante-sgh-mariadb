// Porta PRÓPRIA da CCIH (M48, etapa 3) sobre o MariaDB do cliente, pelo @sgh/nucleo.
// Lê o relógio e os setores do estabelecimento. Os registros da vigilância (dispositivo_invasivo_paciente, caso_infeccao,
// liberacao_antimicrobiano, isolamento_paciente, observacao_higiene_maos, surto_infeccao, verificacao_bundle,
// fechamento_vigilancia_iras) e as leituras assistenciais (internados, prescrições, culturas, cirurgias, censo) aguardam
// o mapeamento (pedido em docs/obra/fatias/f22/saida/04-03.json): até lá as leituras falham fechadas (503 `modelo-pendente`, a tela mostra indisponível) e as gravações
// recusam com `modelo-pendente` (nada é gravado pela metade; a tela fica em consulta).
import { type NucleoQualidade, lerNoEstabelecimento, leituraPendente, liberacaoPendente, modeloPendente, relogioDoEstabelecimento, setoresDoEstabelecimento } from './apoio-propria.js';
import type { ContextoCcih, PortaCcih } from './porta-ccih.js';

const RECURSO = 'A CCIH (dispositivos, IRAS, antimicrobianos, precauções, higiene das mãos e surtos)';

export class PortaCcihPropria implements PortaCcih {
  readonly destino = 'banco' as const;

  constructor(private readonly nucleo: NucleoQualidade) {}

  readonly podeGravar: PortaCcih['podeGravar'] = () => Promise.resolve(liberacaoPendente(RECURSO));

  readonly executar: PortaCcih['executar'] = (_c, op) => Promise.reject(modeloPendente(`${RECURSO} (operação ${op})`));

  readonly gravarSgh: PortaCcih['gravarSgh'] = () => Promise.reject(modeloPendente(RECURSO));

  relogio(c: ContextoCcih) {
    return lerNoEstabelecimento(this.nucleo, c, (l, est) => relogioDoEstabelecimento(l, est));
  }

  unidades(c: ContextoCcih) {
    return lerNoEstabelecimento(this.nucleo, c, (l, est) => setoresDoEstabelecimento(l, est));
  }

  // ── Leituras que aguardam o mapeamento: falham fechadas (503 `modelo-pendente`), nunca vazio nem zero ──

  internados(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  internacao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  altasDas(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  vizinhos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  antimicrobianos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  antimicrobianoPrescrito(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  vigencias(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  consumoDispensado(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  itensAntimicrobianos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  itemDoCadastro(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  fichas(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  culturas(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  exame(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  cirurgias(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  cirurgia(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  temperaturas(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  censo(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  tiposSurto(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  dispositivo(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  dispositivosDas(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  dispositivosNoPeriodo(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  iras(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  irasDas(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  irasNoPeriodo(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  itensConfigurados(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  liberacao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  liberacoesDos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  precaucao(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  precaucoesAbertas(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  precaucoesDa(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  observacoesMaos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  consumoAlcool(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  surto(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  surtos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  sessoesMaos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  observacaoMaos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  versoes(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  competencias(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  dependentes(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  bundles(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  bundle(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  buscarProfissionais(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  profissionaisPorRegistro(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }
}
