// Serviço da tela "Rubricas, incidências e tabelas legais" (M53, etapa F1; ficha, seção 7, `/pessoas/folha/rubricas`;
// seção 8, regra 7). Monta, para a competência, as rubricas em vigor com a conferência das incidências contra os códigos
// do eSocial e a tabela legal em vigor com a conferência das faixas; o apoio traz os domínios oficiais (só rótulos), o
// estado da gravação (chave `pessoas.folha`, POL-3; a tabela legal não depende dela) e os cadastros embutidos.
// Nenhum dado de pessoa: rubrica e tabela legal são parâmetros da empresa (sem trilha de leitura).
import {
  type ApoioRubricas,
  DOMINIOS_DECLARADOS,
  type RubricasDaCompetencia,
  type TabelasLegaisDaCompetencia,
} from '@sgh/contratos';
import {
  conferirRubricas,
  conferirTabelaLegal,
  dataDaCompetencia,
  ordenarVigencias,
  rubricaVigenteNaCompetencia,
  vigenteNaCompetencia,
} from '@sgh/dominio-pessoas';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaRubricas } from './porta-rubricas.js';

export const CHAVE_RUBRICAS_FOLHA = 'pessoas.folha';
export const PERMISSOES_RUBRICAS = {
  ler: 'pessoas.rubrica.ler',
  editar: 'pessoas.rubrica.editar',
  /** D-ABRIR-532: abre a área da folha (menu, telas e o apoio); cada parte pede a sua. */
  abrir: 'pessoas.folha.abrir',
  /** A tabela legal pela permissão do próprio cadastro (opção 370), não pela das rubricas. */
  tabelaLegalLer: 'pessoas.tabelaLegalFolha.ler',
  tabelaLegalEditar: 'pessoas.tabelaLegalFolha.editar',
} as const;
const TTL_DOMINIOS_MS = 10 * 60_000;

/**
 * As quatro migrar-crud do M53 que já eram cadastro do lote do M14 no grupo `pessoas` (ficha, seção 5: as 12 do marco):
 * condições do funcionário, tributos da integração, parâmetros do S-1210 e agrupadores das rotinas de integração.
 */
export const CADASTROS_M14_DA_FOLHA = [
  'condicaoFuncionario',
  'tributoIntegracao',
  'esocialS1210',
  'agrupadorRotina',
] as const;

/**
 * Os cadastros do CRUD genérico que a tela abre embutidos: os 8 do M53 (na ordem da declaração; as rubricas primeiro)
 * e, depois, os 4 do M14 que a ficha conta entre as 12 migrar-crud da folha.
 */
export const CADASTROS_RUBRICAS: readonly string[] = [
  ...DOMINIOS_DECLARADOS.filter((d) => d.marco === 'M53' && d.modulo === 'pessoas'),
  ...CADASTROS_M14_DA_FOLHA.flatMap((r) =>
    DOMINIOS_DECLARADOS.filter((d) => d.marco === 'M14' && d.modulo === 'pessoas' && d.recurso === r),
  ),
].map((d) => `${d.modulo}.${d.recurso}`);

export class ServicoRubricas {
  readonly apoio: ApoioGravacao<never>;
  private readonly cacheDominios = new Map<
    string,
    { ate: number; d: Pick<ApoioRubricas, 'incidenciasEsocial' | 'naturezas'> }
  >();

  constructor(
    readonly porta: PortaRubricas,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
    private readonly agora: () => number = Date.now,
  ) {
    this.apoio = new ApoioGravacao<never>(
      { chave: CHAVE_RUBRICAS_FOLHA, nome: 'a folha de pagamento', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  async rubricas(
    s: SessaoCadastro,
    competencia: string,
    f: { empresa: number | null; todas: boolean },
  ): Promise<RubricasDaCompetencia> {
    const todas = await this.porta.rubricas(s.porta, f.empresa);
    const vigentes = todas.filter((r) => rubricaVigenteNaCompetencia(r.vigencia, competencia));
    const lista = f.todas ? todas : vigentes;
    return {
      competencia,
      dataReferencia: dataDaCompetencia(competencia),
      rubricas: lista,
      foraDeVigencia: todas.length - vigentes.length,
      conferencia: conferirRubricas(lista),
    };
  }

  async tabelasLegais(s: SessaoCadastro, competencia: string): Promise<TabelasLegaisDaCompetencia> {
    const [tabelas, dias] = await Promise.all([
      this.porta.tabelasLegais(s.porta),
      this.porta.diasAfastamento(s.porta),
    ]);
    const todas = ordenarVigencias(tabelas);
    const vigente = vigenteNaCompetencia(todas, competencia);
    const referencia = dataDaCompetencia(competencia);
    const diasOrdenados = [...dias].sort((a, b) => b.inicio.localeCompare(a.inicio));
    return {
      competencia,
      dataReferencia: referencia,
      vigente,
      conferencia: vigente ? conferirTabelaLegal(vigente) : [],
      vigencias: todas.map((t) => t.inicio),
      // Regra 7: a mesma data de referência (primeiro dia da competência, D-VIG-532) vale para os dias de afastamento.
      afastamento: {
        vigente: diasOrdenados.find((d) => d.inicio <= referencia) ?? null,
        vigencias: diasOrdenados,
      },
    };
  }

  private async dominios(s: SessaoCadastro) {
    const c = this.cacheDominios.get(s.hospital);
    if (c && c.ate > this.agora()) return c.d;
    const d = await this.porta.dominios(s.porta);
    this.cacheDominios.set(s.hospital, { ate: this.agora() + TTL_DOMINIOS_MS, d });
    return d;
  }

  async apoioTela(s: SessaoCadastro): Promise<ApoioRubricas> {
    const [dominios, liberacao] = await Promise.all([this.dominios(s), this.apoio.liberacao(s)]);
    const podeEditar = s.pode(PERMISSOES_RUBRICAS.editar);
    // A tabela legal grava sem a chave da folha (D-CHAVE-532): o estado dela é à parte, só pelas permissões (o CRUD
    // genérico exige a do cadastro e a do grupo, `pessoas.rubrica.editar`).
    const tabelaEditar = s.pode(PERMISSOES_RUBRICAS.tabelaLegalEditar) && podeEditar;
    return {
      ...dominios,
      gravacaoLigada: podeEditar && liberacao.ligada,
      motivoDesligada: !podeEditar
        ? 'Seu perfil não permite alterar as rubricas.'
        : liberacao.ligada
          ? null
          : liberacao.motivo,
      lerRubricas: s.pode(PERMISSOES_RUBRICAS.ler),
      tabelaLegal: {
        ler: s.pode(PERMISSOES_RUBRICAS.tabelaLegalLer),
        gravacaoLigada: tabelaEditar,
        motivoDesligada: tabelaEditar ? null : 'Seu perfil não permite alterar as tabelas legais.',
      },
      // Só os cadastros que o perfil consulta (o CRUD genérico confere de novo cada um).
      cadastros: CADASTROS_RUBRICAS.filter((c) => s.pode(`${c}.ler`)),
    };
  }
}
