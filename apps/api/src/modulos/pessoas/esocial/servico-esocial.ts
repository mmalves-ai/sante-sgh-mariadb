// Serviço do eSocial, fatia F5 (M53.6; ficha do M53, seções 1, 4 a 8; regras 1, 2, 3 e 9): os parâmetros do eSocial do
// empregador (transmissor único por raiz de CNPJ), a ficha do eSocial do colaborador (cifrada), a geração dos eventos de
// tabela e do trabalhador (montados e conferidos no XSD oficial pela regra pura de @sgh/dominio-pessoas), o ciclo do
// evento (descarte, exclusão pelo S-3000, retificação), os lotes (ao coletor fora de `producao`), o retorno, as
// pendências do outro sistema (só contagem) e a conciliação com o repasse. Grava só SGH_ com a trilha na mesma
// transação, atrás da chave `pessoas.folha` (POL-3); a transmissão real em `producao` exige ainda a chave
// `pessoas.esocial` (certificado do empregador). Nenhuma lista traz CPF ou nome.
//
// D-CHAVE-536 (POL-5): gerar, gravar a ficha e os parâmetros e entregar o lote ao coletor seguem a chave da folha do
// Sante SGH (`pessoas.folha`), porque são o trabalho do departamento pessoal e nada sai da máquina; a chave do eSocial
// (`pessoas.esocial`, com o certificado como pré-requisito) só libera o envio ao serviço do governo em `producao`.
// D-PREVIA-536 (POL-5): a prévia do evento do trabalhador não devolve o XML (traz CPF, nome e endereço): devolve a
// validade, os erros do XSD e as pendências; o XML se lê no detalhe do evento gravado, com leitura auditada.
import { createHash } from 'node:crypto';
import {
  type ApoioEsocial,
  CATALOGO_EVENTOS_ESOCIAL,
  CHAVE_PESSOAS_ESOCIAL,
  CHAVE_PESSOAS_FOLHA,
  type ConciliacaoEsocial,
  type ConferirConciliacaoEsocialEntrada,
  type DescartarEventoEsocialEntrada,
  definicaoEventoEsocial,
  type DetalheEventoEsocial,
  type DetalheLoteEsocial,
  type EmpregadorEsocial,
  type EmpregadorEsocialLido,
  esquemaEmpregadorEsocial,
  esquemaFichaEsocialVinculo,
  EVENTOS_AUDITAVEIS,
  type EventoEsocial,
  type EventoEsocialResumo,
  type EventoGerado,
  type ExcluirEventoEsocialEntrada,
  type FichaEsocialDoVinculo,
  type FichaEsocialVinculo,
  type FiltroConciliacaoEsocial,
  type FiltroEventosEsocial,
  type FiltroLotesEsocial,
  type GerarEventosTabelaEntrada,
  type GerarEventoTrabalhadorEntrada,
  LEIAUTES_ESOCIAL,
  type LinhaConciliacaoEsocial,
  type ListaEventosEsocial,
  type ListaLotesEsocial,
  type LoteEsocial,
  type MontarLoteEsocialEntrada,
  type OperacaoTabelaEsocial,
  type PendenciaEsocial,
  type PendenciasLegadoEsocial,
  type RegistrarFichaEsocialEntrada,
  type ResultadoGeracaoEsocial,
  type RetornoLoteEsocialEntrada,
  type TipoVinculoTrabalho,
  type EnviarLoteEsocialEntrada,
  type CancelarLoteEsocialEntrada,
  NUMERO_GRUPO_ESOCIAL,
} from '@sgh/contratos';
import {
  ambienteDoLote,
  type CatParaEvento,
  conciliar,
  conferirLote,
  type ContextoEventoEsocial,
  decidirEnvio,
  decidirTransmissor,
  type EmpregadorParaEvento,
  empresasDaMesmaRaiz,
  errosSemValores,
  esquemasDoLeiaute,
  montarS1000,
  montarS1005,
  montarS1010,
  montarS1020,
  montarS2200,
  montarS2205,
  montarS2206,
  montarS2210,
  montarS2230,
  montarS2299,
  montarS2300,
  montarS2399,
  montarS3000,
  painelPendenciasLegado,
  podeTransitar,
  raizCnpj,
  type ResultadoEventoEsocial,
  SITUACOES_EM_VIGOR,
  SITUACOES_TRANSMITIDAS,
  tpAmbDoAmbiente,
  type TrabalhadorParaEvento,
  validarEventoNoXsd,
  type VigenciaTransmissor,
  xmlDoEvento,
  xmlParaConferencia,
} from '@sgh/dominio-pessoas';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { CifraCpf } from '../cifra-cpf.js';
import type { PortaCalculoFolha } from '../folha/porta-calculo.js';
import type { PortaFolha } from '../folha/porta-folha.js';
import type { PortaPessoas } from '../porta.js';
import type { PortaRubricas } from '../rubricas/porta-rubricas.js';
import {
  type ContextoEsocial,
  type GravadorEsocial,
  type PortaEsocial,
  type RegistroEventoEsocial,
  type RegistroLoteEsocial,
  TETO_EVENTOS_ESOCIAL,
  TETO_LOTES_ESOCIAL,
  type VigenciaEmpregadorEsocial,
} from './porta-esocial.js';
import { eventoAceito, loteEmProcessamento, type Ocorrencia } from './transmissor/soap-esocial.js';
import {
  type DisponibilidadeTransmissor,
  ErroTransmissorEsocial,
  type EventoParaTransmitir,
} from './transmissor/transmissor-esocial.js';

/** O vínculo como a porta de pessoas o lê. */
type VinculoDoCadastro = NonNullable<Awaited<ReturnType<PortaPessoas['vinculo']>>>;

/** Sem o transmissor real (POL-3): o motivo que a tela mostra em `producao`. */
export const TRANSMISSOR_DESLIGADO: DisponibilidadeTransmissor = {
  transmissor: null,
  motivo: 'O envio ao serviço do eSocial não está habilitado neste servidor.',
};

/** Texto do retorno do eSocial sem número longo (CPF, CNPJ, NIS) nem valor entre aspas, para gravar e mostrar. */
export function textoRetornoSemValores(t: string): string {
  return t
    .replace(/["'\u201c\u201d][^"'\u201c\u201d]{0,200}["'\u201c\u201d]/g, '(valor)')
    .replace(/\d[\d.\-/]{6,}\d/g, '(valor)')
    .replace(/\s+/g, ' ')
    .trim();
}

const resumoOcorrencias = (desc: string, oc: readonly Ocorrencia[]) =>
  textoRetornoSemValores([desc, ...oc.map((o) => `${o.codigo} ${o.descricao}`)].filter(Boolean).join(' · '));

export const PERMISSOES_ESOCIAL = {
  ler: 'pessoas.esocial.ler',
  gerar: 'pessoas.esocial.gerar',
  transmitir: 'pessoas.esocial.transmitir',
} as const;
const P = PERMISSOES_ESOCIAL;
const E = EVENTOS_AUDITAVEIS;

/** Versão do aplicativo no evento (verProc). */
export const VERSAO_PROCESSO_ESOCIAL = 'SanteSGH-1.0';

/** O identificador provisório da montagem (trocado pelo definitivo, que sai do ID do evento, na gravação). */
const INSTANTE_PROVISORIO = '2000-01-01T00:00:00';

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    'O registro não existe neste estabelecimento.',
  );
const recusa = (codigo: string, mensagem: string, extra: object = {}) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, { codigo, ...extra });

const TIPOS_VINCULO: readonly TipoVinculoTrabalho[] = [
  'clt',
  'estatutario',
  'cooperado',
  'pj',
  'residente',
  'estagiario',
  'terceiro',
];
const tipoVinculo = (t: string): TipoVinculoTrabalho =>
  (TIPOS_VINCULO as readonly string[]).includes(t) ? (t as TipoVinculoTrabalho) : 'terceiro';

/** O resumo do evento para a API (sem o XML; nenhum dado pessoal). */
export const paraResumoEsocial = (
  x: RegistroEventoEsocial,
  matricula: string | null,
): EventoEsocialResumo => ({
  id: x.id,
  empresa: x.empresa,
  evento: x.evento,
  grupo: x.grupo,
  operacao: x.operacao,
  idEsocial: x.idEsocial,
  vinculo: x.vinculo,
  matricula,
  origem: x.origem,
  referencia: x.referencia,
  dataReferencia: x.dataReferencia,
  situacao: x.situacao,
  eventoAnterior: x.eventoAnterior,
  lote: x.lote,
  recibo: x.recibo,
  retorno: x.retornoCodigo ? { codigo: x.retornoCodigo, descricao: x.retornoDescricao ?? '' } : null,
  leiaute: (LEIAUTES_ESOCIAL as readonly string[]).includes(x.leiaute)
    ? (x.leiaute as EventoEsocialResumo['leiaute'])
    : 'v_S_01_03_00',
  hashXml: x.hashXml,
  // Também as linhas gravadas antes da limpeza das mensagens (achado do corretor do M53.6).
  errosXsd: x.errosXsd.map(errosSemValores),
  motivo: x.motivo,
  criadoPor: x.criadoPor,
  criadoEm: x.criadoEm,
  versao: x.versao,
});

const paraLote = (l: RegistroLoteEsocial): LoteEsocial => ({
  id: l.id,
  empresa: l.empresa,
  grupo: l.grupo,
  ambiente: l.ambiente,
  situacao: l.situacao,
  quantidade: l.quantidade,
  protocolo: l.protocolo,
  enviadoPor: l.enviadoPor,
  enviadoEm: l.enviadoEm,
  criadoPor: l.criadoPor,
  criadoEm: l.criadoEm,
  versao: l.versao,
});

/** Os parâmetros gravados (JSON) validados pelo contrato; vigência corrompida não entra em conta. */
export function empregadorDaLinha(x: VigenciaEmpregadorEsocial): EmpregadorEsocialLido | null {
  let extra: unknown;
  try {
    extra = JSON.parse(x.parametros);
  } catch {
    return null;
  }
  const r = esquemaEmpregadorEsocial.safeParse({
    ...(extra as object),
    empresa: x.empresa,
    inicio: x.inicio,
    transmissor: x.transmissor,
    leiaute: x.leiaute,
  });
  return r.success ? { ...r.data, id: x.id, criadoPor: x.criadoPor, criadoEm: x.criadoEm } : null;
}

/** A vigência da empresa na competência (a mais recente que já começou). */
export const vigenciaNa = (vs: readonly EmpregadorEsocialLido[], empresa: number, competencia: string) =>
  vs
    .filter((v) => v.empresa === empresa && v.inicio <= competencia)
    .sort((a, b) => b.inicio.localeCompare(a.inicio))[0] ?? null;

/** Data e hora do banco em 14 dígitos (ano, mês, dia, hora, minuto, segundo): o leiaute do Id do evento. */
const instanteEsocial = (agora: string) => agora.replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
const pad5 = (n: number) => (n % 99_999) + 1;

/** O evento montado e conferido, pronto para gravar. */
export interface EventoMontado {
  readonly evento: EventoEsocial;
  readonly operacao: OperacaoTabelaEsocial | null;
  readonly origem: string;
  readonly referencia: number;
  readonly vinculo: number | null;
  readonly montagem: ResultadoEventoEsocial;
  readonly valido: boolean;
  readonly errosXsd: readonly string[];
  readonly eventoAnterior: number | null;
  /**
   * M53-F6: as situações que barram outro original para a mesma origem (padrão: SITUACOES_EM_VIGOR). O S-1299 e o S-1298
   * olham só os em andamento: depois de uma reabertura aceita, o período se fecha de novo com outro S-1299.
   */
  readonly situacoesRepetido?: readonly string[];
}

export class ServicoEsocial {
  readonly apoio: ApoioGravacao<GravadorEsocial>;
  readonly apoioTransmissao: ApoioGravacao<GravadorEsocial>;

  constructor(
    readonly porta: PortaEsocial,
    readonly folha: PortaFolha,
    readonly calculo: PortaCalculoFolha,
    readonly rubricas: PortaRubricas,
    readonly pessoas: PortaPessoas,
    readonly cifra: CifraCpf | null,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
    /** O ambiente do sistema (AMBIENTE): fora de `producao` o lote vai ao coletor (regra 3). */
    readonly ambiente: string = (process.env['AMBIENTE'] ?? 'dev').trim(),
    /** O transmissor real do eSocial (só em `producao`, com o certificado conferido; POL-3). */
    readonly transmissao: DisponibilidadeTransmissor = TRANSMISSOR_DESLIGADO,
  ) {
    this.apoio = new ApoioGravacao<GravadorEsocial>(
      { chave: CHAVE_PESSOAS_FOLHA, nome: 'a folha de pagamento', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.apoioTransmissao = new ApoioGravacao<GravadorEsocial>(
      { chave: CHAVE_PESSOAS_ESOCIAL, nome: 'a transmissão ao eSocial', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private ctx(s: SessaoCadastro): ContextoEsocial {
    return s.porta;
  }

  private async empresasDoCadastro(s: SessaoCadastro) {
    return this.folha.empresas(this.ctx(s));
  }

  private async exigirEmpresa(s: SessaoCadastro, empresa: number): Promise<void> {
    if (!(await this.empresasDoCadastro(s)).some((e) => e.codigo === empresa)) throw naoEncontrado('Empresa');
  }

  private async vigencias(s: SessaoCadastro): Promise<EmpregadorEsocialLido[]> {
    const xs = await this.porta.empregadores(this.ctx(s), null);
    return xs.map(empregadorDaLinha).filter((x): x is EmpregadorEsocialLido => x !== null);
  }

  /** Uso do módulo (os periódicos do M53.7). */
  exigirCifra(): CifraCpf {
    if (!this.cifra)
      throw recusa(
        'ficha-sem-chave',
        'A chave de proteção dos dados de colaboradores não está configurada: os eventos do trabalhador ficam desligados.',
      );
    return this.cifra;
  }

  // ── Apoio ───────────────────────────────────────────────────────────────────────────────────────────────────

  async apoioTela(s: SessaoCadastro): Promise<ApoioEsocial> {
    const c = this.ctx(s);
    const relogio = await this.folha.relogio(c);
    const [empresas, cnpjs, leiaute, catalogo, motivos, categorias, folhaLigada, esocialLigada] =
      await Promise.all([
        this.folha.empresas(c),
        this.porta.cnpjs(c),
        this.porta.leiauteCatalogo(c, relogio.hoje),
        this.porta.eventosCatalogo(c),
        this.porta.motivosAfastamento(c),
        this.porta.categorias(c),
        this.apoio.liberacao(s),
        this.apoioTransmissao.liberacao(s),
      ]);
    const envio = decidirEnvio(this.ambiente, esocialLigada.ligada, this.transmissao.transmissor !== null);
    const motivo = !folhaLigada.ligada
      ? folhaLigada.motivo
      : !envio.ok
        ? this.motivoEnvio(envio)
        : !s.pode(P.transmitir)
          ? 'Seu perfil não permite esta ação.'
          : null;
    return {
      hoje: relogio.hoje,
      empresas: empresas.map((e) => ({ codigo: e.codigo, rotulo: e.rotulo, temCnpj: !!cnpjs.get(e.codigo) })),
      eventos: CATALOGO_EVENTOS_ESOCIAL,
      leiautes: LEIAUTES_ESOCIAL,
      // A versão vigente de cada evento com o nome oficial do catálogo do banco.
      leiauteCatalogo: leiaute.map((x) => ({
        ...x,
        nome: catalogo.find((e) => e.codigo === x.evento)?.nome || null,
      })),
      motivosAfastamento: motivos,
      categorias,
      transmissao: {
        chaveLigada: esocialLigada.ligada,
        ambiente: ambienteDoLote(this.ambiente),
        podeEnviar: folhaLigada.ligada && envio.ok && s.pode(P.transmitir),
        motivo,
      },
      acoes: {
        gerar: s.pode(P.gerar) && folhaLigada.ligada,
        transmitir: s.pode(P.transmitir) && folhaLigada.ligada,
      },
    };
  }

  // ── Parâmetros do empregador ────────────────────────────────────────────────────────────────────────────────

  async empregadores(s: SessaoCadastro, empresa: number | null): Promise<EmpregadorEsocialLido[]> {
    const xs = await this.porta.empregadores(this.ctx(s), empresa);
    return xs.map(empregadorDaLinha).filter((x): x is EmpregadorEsocialLido => x !== null);
  }

  /** Nova vigência; a mesma raiz de CNPJ não pode ter dois transmissores (regra 1). */
  async registrarEmpregador(s: SessaoCadastro, x: EmpregadorEsocial): Promise<EmpregadorEsocialLido> {
    await this.exigirEmpresa(s, x.empresa);
    const cnpjs = await this.porta.cnpjs(this.ctx(s));
    const { empresa, inicio, transmissor, leiaute, ...parametros } = x;
    const id = await this.apoio.sgh(
      s,
      E.pessoasEsocialEmpregadorGravado.codigo,
      P.gerar,
      (r: number) => ({ tabela: 'cadastro_empregador', id: String(r), chave: `${empresa}:${inicio}` }),
      async (g) => {
        const vs = (await g.empregadores(null))
          .map(empregadorDaLinha)
          .filter((v): v is EmpregadorEsocialLido => v !== null);
        const vig: VigenciaTransmissor[] = [...vs, { empresa, inicio, transmissor }];
        for (const outra of empresasDaMesmaRaiz(cnpjs, empresa)) {
          const competencias = [
            inicio,
            ...vig.filter((v) => v.empresa === outra && v.inicio > inicio).map((v) => v.inicio),
          ];
          for (const comp of competencias)
            if (!decidirTransmissor(vig, cnpjs, empresa, comp).ok)
              throw recusa(
                'dois-transmissores',
                `A empresa ${outra} tem a mesma raiz de CNPJ e outro transmissor do eSocial: um empregador tem um transmissor só.`,
              );
        }
        return g.incluirEmpregador({
          empresa,
          inicio,
          transmissor,
          leiaute,
          parametros: JSON.stringify(parametros),
          por: s.login,
        });
      },
    );
    const lido = (await this.empregadores(s, empresa)).find((v) => v.id === id);
    if (!lido) throw naoEncontrado('Parâmetros do eSocial');
    return lido;
  }

  // ── Ficha do eSocial do colaborador ─────────────────────────────────────────────────────────────────────────

  /** Uso do módulo (os periódicos do M53.7). */
  async vinculoOu404(s: SessaoCadastro, id: number): Promise<VinculoDoCadastro> {
    const v = await this.pessoas.vinculo(s.porta, id);
    if (!v) throw naoEncontrado('Colaborador');
    return v;
  }

  private decifrarFicha(texto: string): FichaEsocialVinculo | null {
    const t = this.cifra?.decifrarTexto(texto) ?? null;
    if (t === null) return null;
    try {
      const r = esquemaFichaEsocialVinculo.safeParse(JSON.parse(t));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  }

  /** A ficha (decifrada só com `pessoas.esocial.gerar`; a rota audita a leitura). */
  async ficha(s: SessaoCadastro, vinculo: number): Promise<FichaEsocialDoVinculo> {
    const v = await this.vinculoOu404(s, vinculo);
    const f = await this.porta.ficha(this.ctx(s), vinculo);
    return {
      vinculo,
      matricula: v.matricula,
      preenchida: !!f,
      ficha: f && s.pode(P.gerar) ? this.decifrarFicha(f.dadosCifrados) : null,
      versao: f?.versao ?? null,
      alteradoPor: f?.alteradoPor ?? null,
      alteradoEm: f?.alteradoEm ?? null,
    };
  }

  async registrarFicha(
    s: SessaoCadastro,
    vinculo: number,
    x: RegistrarFichaEsocialEntrada,
  ): Promise<FichaEsocialDoVinculo> {
    await this.vinculoOu404(s, vinculo);
    const cifra = this.exigirCifra();
    const dados = cifra.cifrarTexto(JSON.stringify(x.ficha));
    await this.apoio.sgh(
      s,
      E.pessoasEsocialFichaGravada.codigo,
      P.gerar,
      (r: { id: number }) => ({
        tabela: 'vinculo_trabalho',
        id: String(r.id),
        chave: `vinculo:${vinculo}`,
      }),
      (g) => g.gravarFicha({ vinculo, dadosCifrados: dados, versao: x.versao, por: s.login }),
    );
    return this.ficha(s, vinculo);
  }

  // ── Geração dos eventos ─────────────────────────────────────────────────────────────────────────────────────

  /** O empregador para o evento: a vigência na competência, o CNPJ e o transmissor conferido (regra 1). */
  /** Uso do módulo (os periódicos do M53.7). */
  async empregadorPara(
    s: SessaoCadastro,
    empresa: number,
    competencia: string,
  ): Promise<EmpregadorParaEvento> {
    await this.exigirEmpresa(s, empresa);
    const [vs, cnpjs] = await Promise.all([this.vigencias(s), this.porta.cnpjs(this.ctx(s))]);
    const vig = vigenciaNa(vs, empresa, competencia);
    if (!vig)
      throw recusa(
        'empregador-sem-parametros',
        'A empresa não tem os parâmetros do eSocial vigentes nesta data: registre-os antes de gerar eventos.',
      );
    const d = decidirTransmissor(vs, cnpjs, empresa, competencia);
    if (!d.ok)
      throw recusa(
        d.motivo === 'dois-transmissores' ? 'dois-transmissores' : 'empregador-sem-parametros',
        'Empresas com a mesma raiz de CNPJ estão com transmissores diferentes: um empregador tem um transmissor só.',
      );
    if (d.transmissor === 'externo')
      throw recusa(
        'transmissor-externo',
        'O eSocial desta empresa é transmitido pelo sistema externo nesta competência: o Sante SGH não gera os eventos.',
      );
    return { ...vig, cnpj: cnpjs.get(empresa) ?? null };
  }

  /** Uso do módulo (os periódicos do M53.7). */
  contexto(leiaute: EmpregadorEsocial['leiaute']): ContextoEventoEsocial {
    return {
      leiaute,
      tpAmb: tpAmbDoAmbiente(ambienteDoLote(this.ambiente)),
      verProc: VERSAO_PROCESSO_ESOCIAL,
      instante: INSTANTE_PROVISORIO,
      sequencia: 1,
    };
  }

  /** Confere a montagem no XSD do leiaute (regra 9). */
  /** Uso do módulo (os periódicos do M53.7). */
  async conferir(
    m: ResultadoEventoEsocial,
    evento: EventoEsocial,
    leiaute: EmpregadorEsocial['leiaute'],
  ): Promise<{ valido: boolean; erros: readonly string[] }> {
    if (!m.ok) return { valido: false, erros: [] };
    const r = await validarEventoNoXsd(
      xmlParaConferencia(m.raiz),
      definicaoEventoEsocial(evento).raiz,
      await esquemasDoLeiaute(leiaute),
    );
    return { valido: r.valido, erros: r.erros };
  }

  /**
   * Grava os eventos montados: cada um ganha o ID do banco, o identificador definitivo (instante do relógio do banco e a
   * sequência do ID) e o XML com ele (cifrado quando é do trabalhador); a recusa de repetido vale por evento em vigor.
   */
  /** Uso do módulo (os periódicos do M53.7). */
  async gravarEventos(
    s: SessaoCadastro,
    empresa: number,
    leiaute: EmpregadorEsocial['leiaute'],
    montados: readonly EventoMontado[],
    cifrar: boolean,
  ): Promise<Map<EventoMontado, number>> {
    const agora = instanteEsocial((await this.folha.relogio(this.ctx(s))).agora);
    const cifra = cifrar ? this.exigirCifra() : null;
    return this.apoio.sgh(
      s,
      E.pessoasEsocialEventoGerado.codigo,
      P.gerar,
      (r: Map<EventoMontado, number>) => ({
        tabela: 'evento_esocial',
        id: [...r.values()].join(',').slice(0, 40),
        chave: `${empresa}:${montados.map((m) => m.evento).join(',')}`.slice(0, 120),
      }),
      async (g) => {
        const ids = new Map<EventoMontado, number>();
        for (const m of montados) {
          if (!m.montagem.ok) continue;
          if (m.eventoAnterior === null || m.evento === 'S-3000') {
            // M53-F6: o periódico é um por período (a data de referência é o período de apuração).
            const porPeriodo = m.operacao || definicaoEventoEsocial(m.evento).grupo === 'periodico';
            const vigor = await g.eventos({
              empresa,
              evento: m.evento,
              origem: m.origem,
              referencia: m.referencia,
              situacoes: m.situacoesRepetido ?? SITUACOES_EM_VIGOR,
              ...(porPeriodo ? { de: m.montagem.dataReferencia, ate: m.montagem.dataReferencia } : {}),
            });
            const repetido = vigor.filter(
              (x) =>
                x.operacao === m.operacao && (m.evento !== 'S-3000' || x.eventoAnterior === m.eventoAnterior),
            );
            if (repetido.length)
              throw recusa(
                'evento-ja-gerado',
                `Já há um ${m.evento} em andamento para este registro (evento ${repetido[0]!.id}): use a retificação, a exclusão ou descarte o anterior.`,
              );
          }
          const sequencial = await g.proximoSequencialEvento();
          const idEsocial =
            m.montagem.idEsocial.slice(0, 17) + agora + String(pad5(sequencial)).padStart(5, '0');
          const xml = xmlDoEvento(m.montagem.raiz).replace(
            `Id="${m.montagem.idEsocial}"`,
            `Id="${idEsocial}"`,
          );
          const id = await g.incluirEvento({
            empresa,
            evento: m.evento,
            grupo: definicaoEventoEsocial(m.evento).grupo,
            operacao: m.operacao,
            idEsocial,
            vinculo: m.vinculo,
            origem: m.origem,
            referencia: m.referencia,
            dataReferencia: m.montagem.dataReferencia,
            leiaute,
            xml: cifra ? cifra.cifrarTexto(xml) : xml,
            xmlCifrado: !!cifra,
            hashXml: sha256(xml),
            errosXsd: m.errosXsd,
            situacao: m.valido ? 'validado' : 'invalido',
            eventoAnterior: m.eventoAnterior,
            por: s.login,
          });
          ids.set(m, id);
        }
        return ids;
      },
    );
  }

  /** Uso do módulo (os periódicos do M53.7). */
  resultado(
    montados: readonly EventoMontado[],
    ids: Map<EventoMontado, number> | null,
    comXml: boolean,
  ): ResultadoGeracaoEsocial {
    const eventos: EventoGerado[] = montados.map((m) => ({
      evento: m.evento,
      operacao: m.operacao,
      origem: m.origem,
      referencia: m.referencia,
      dataReferencia: m.montagem.ok ? m.montagem.dataReferencia : '',
      pendencias: m.montagem.ok ? [] : m.montagem.pendencias,
      valido: m.valido,
      errosXsd: m.errosXsd,
      xml: m.montagem.ok && comXml ? xmlDoEvento(m.montagem.raiz) : null,
      id: ids?.get(m) ?? null,
    }));
    return { gravado: ids !== null, eventos };
  }

  /** Eventos de tabela (prévia ou gravados): S-1000, S-1005, S-1020 e um S-1010 por rubrica. */
  async gerarTabela(s: SessaoCadastro, x: GerarEventosTabelaEntrada): Promise<ResultadoGeracaoEsocial> {
    if (x.gravar) await this.apoio.exigirLiberacao(s);
    const emp = await this.empregadorPara(s, x.empresa, x.inicio);
    const ctx = this.contexto(emp.leiaute);
    const montados: EventoMontado[] = [];
    const add = async (
      evento: EventoEsocial,
      origem: string,
      referencia: number,
      m: ResultadoEventoEsocial,
    ) => {
      const v = await this.conferir(m, evento, emp.leiaute);
      montados.push({
        evento,
        operacao: x.operacao,
        origem,
        referencia,
        vinculo: null,
        montagem: m,
        valido: v.valido,
        errosXsd: v.erros,
        eventoAnterior: null,
      });
    };
    for (const evento of x.eventos) {
      if (evento === 'S-1000')
        await add(evento, 'empregador', x.empresa, montarS1000(ctx, emp, x.operacao, x.inicio));
      if (evento === 'S-1005')
        await add(evento, 'estabelecimento', x.empresa, montarS1005(ctx, emp, x.operacao, x.inicio));
      if (evento === 'S-1020')
        await add(evento, 'lotacao', x.empresa, montarS1020(ctx, emp, x.operacao, x.inicio));
      if (evento === 'S-1010') {
        const todas = await this.rubricas.rubricas(this.ctx(s), x.empresa);
        const rs = x.rubricas.length
          ? todas.filter((r) => x.rubricas.includes(r.id))
          : todas.filter((r) => r.ativa);
        if (x.rubricas.length && rs.length !== new Set(x.rubricas).size) throw naoEncontrado('Rubrica');
        for (const r of rs)
          await add(
            evento,
            'rubrica',
            r.id,
            montarS1010(ctx, emp, x.operacao, x.inicio, r, r.natureza === null ? null : String(r.natureza)),
          );
      }
    }
    if (!x.gravar) return this.resultado(montados, null, true);
    const ids = await this.gravarEventos(s, x.empresa, emp.leiaute, montados, false);
    return this.resultado(montados, ids, true);
  }

  /** O trabalhador para o evento na data: CPF decifrado e nome só aqui (nunca em resposta), ficha e salário vigente. */
  /** Uso do módulo (os periódicos do M53.7). */
  async trabalhadorPara(
    s: SessaoCadastro,
    v: VinculoDoCadastro,
    data: string,
  ): Promise<TrabalhadorParaEvento> {
    const cifra = this.exigirCifra();
    const [f, salarios] = await Promise.all([
      this.porta.ficha(this.ctx(s), v.id),
      this.calculo.salarios(this.ctx(s), [v.id]),
    ]);
    const sal = salarios
      .filter((x) => x.vinculo === v.id && x.inicio <= data)
      .sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
    return {
      vinculo: v.id,
      matricula: v.matricula,
      tipo: tipoVinculo(v.tipo),
      cpf: cifra.decifrar(v.cpfCifrado),
      nome: v.nome,
      cargo: v.cargo,
      funcao: v.funcao,
      cargaSemanal: v.cargaSemanal,
      admissao: v.admissao,
      desligamento: v.desligamento,
      ficha: f ? this.decifrarFicha(f.dadosCifrados) : null,
      salario: sal?.salario ?? null,
    };
  }

  /** O evento aceito que a retificação troca (mesmo evento e vínculo, com recibo). */
  private async retificado(
    s: SessaoCadastro,
    id: number | null,
    evento: EventoEsocial,
    vinculo: number,
  ): Promise<RegistroEventoEsocial | null> {
    if (id === null) return null;
    const r = await this.porta.evento(this.ctx(s), id);
    if (!r) throw naoEncontrado('Evento');
    if (
      r.evento.evento !== evento ||
      r.evento.vinculo !== vinculo ||
      r.evento.situacao !== 'aceito' ||
      !r.evento.recibo
    )
      throw recusa(
        'evento-sem-recibo',
        'Só se retifica um evento aceito, com recibo, do mesmo colaborador e do mesmo tipo.',
      );
    return r.evento;
  }

  /** Evento do trabalhador (prévia sem XML, D-PREVIA-536; ou gravado). */
  async gerarTrabalhador(
    s: SessaoCadastro,
    x: GerarEventoTrabalhadorEntrada,
  ): Promise<ResultadoGeracaoEsocial> {
    if (x.gravar) await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, x.vinculo);
    const c = this.ctx(s);
    let data: string;
    let origem: string;
    let referencia: number;
    let montar: (
      ctx: ContextoEventoEsocial,
      e: EmpregadorParaEvento,
      t: TrabalhadorParaEvento,
      recibo: string | null,
    ) => Promise<ResultadoEventoEsocial>;
    const exigirData = () => {
      if (!x.data) throw recusa('referencia-obrigatoria', 'Informe a data da alteração.');
      return x.data;
    };
    switch (x.evento) {
      case 'S-2200':
      case 'S-2300':
        data = v.admissao;
        origem = 'vinculo';
        referencia = v.id;
        montar = async (ctx, e, t, rec) =>
          x.evento === 'S-2200' ? montarS2200(ctx, e, t, rec) : montarS2300(ctx, e, t, rec);
        break;
      case 'S-2205':
        data = exigirData();
        origem = 'cadastro';
        referencia = v.id;
        montar = async (ctx, e, t, rec) => montarS2205(ctx, e, t, data, rec);
        break;
      case 'S-2206': {
        if (x.referencia !== null) {
          const sal = (await this.calculo.salarios(c, [v.id])).find((y) => y.id === x.referencia);
          if (!sal) throw recusa('referencia-invalida', 'A vigência do salário não é deste colaborador.');
          data = sal.inicio;
          origem = 'salario';
          referencia = sal.id;
        } else {
          data = exigirData();
          origem = 'contrato';
          referencia = v.id;
        }
        montar = async (ctx, e, t, rec) => montarS2206(ctx, e, t, data, rec);
        break;
      }
      case 'S-2230': {
        if (x.referencia === null) throw recusa('referencia-obrigatoria', 'Escolha o afastamento.');
        const a = await this.folha.afastamento(c, x.referencia);
        if (!a || a.vinculo !== v.id || a.situacao !== 'ativo')
          throw recusa('referencia-invalida', 'O afastamento não é deste colaborador ou foi cancelado.');
        data = a.inicio;
        origem = 'afastamento';
        referencia = a.id;
        montar = async (ctx, e, t, rec) =>
          montarS2230(ctx, e, t, { id: a.id, motivo: a.motivo, inicio: a.inicio, fim: a.fim }, rec);
        break;
      }
      case 'S-2299': {
        if (x.referencia === null) throw recusa('referencia-obrigatoria', 'Escolha a rescisão calculada.');
        const r = await this.calculo.rescisaoPorId(c, x.referencia);
        if (!r || r.vinculo !== v.id || r.situacao !== 'calculada' || r.empresa !== x.empresa)
          throw recusa(
            'referencia-invalida',
            'A rescisão não é deste colaborador nesta empresa ou não está em vigor.',
          );
        const linhas = await this.calculo.linhasDoVinculo(c, r.processo, v.id);
        data = r.desligamento;
        origem = 'rescisao';
        referencia = r.id;
        montar = async (ctx, e, t, rec) =>
          montarS2299(
            ctx,
            e,
            t,
            {
              id: r.id,
              desligamento: r.desligamento,
              modalidade: r.modalidade,
              diasIndenizados: r.diasIndenizados,
              projecao: r.projecao,
              linhas,
            },
            rec,
          );
        break;
      }
      case 'S-2399':
        if (!v.desligamento)
          throw recusa('referencia-obrigatoria', 'O colaborador não tem o término registrado.');
        data = v.desligamento;
        origem = 'termino';
        referencia = v.id;
        montar = async (ctx, e, t, rec) => montarS2399(ctx, e, t, v.desligamento, rec);
        break;
    }
    const emp = await this.empregadorPara(s, x.empresa, data.slice(0, 7));
    const anterior = await this.retificado(s, x.retificar, x.evento, v.id);
    const t = await this.trabalhadorPara(s, v, data);
    const m = await montar(this.contexto(emp.leiaute), emp, t, anterior?.recibo ?? null);
    const conf = await this.conferir(m, x.evento, emp.leiaute);
    const montado: EventoMontado = {
      evento: x.evento,
      operacao: null,
      origem,
      referencia,
      vinculo: v.id,
      montagem: m,
      valido: conf.valido,
      errosXsd: conf.erros,
      eventoAnterior: anterior?.id ?? null,
    };
    if (!x.gravar) return this.resultado([montado], null, false);
    const ids = await this.gravarEventos(s, x.empresa, emp.leiaute, [montado], true);
    return this.resultado([montado], ids, false);
  }

  /** Revisão W0-06: o S-2200/S-2300 do vínculo na fila, de todas as situações (a correção cadastral os confere). */
  async eventosVinculo(s: SessaoCadastro, vinculo: number): Promise<RegistroEventoEsocial[]> {
    return this.porta.eventos(this.ctx(s), {
      eventos: ['S-2200', 'S-2300'],
      origem: 'vinculo',
      referencia: vinculo,
    });
  }

  // ── W0-06: o S-2210 do acidente do SESMT ───────────────────────────────────────────────────────────────────

  /** As empresas que podem gerar o S-2210 do acidente (o SESMT escolhe a do empregador do vínculo). */
  async empresasCat(s: SessaoCadastro): Promise<{ codigo: number; rotulo: string }[]> {
    return (await this.folha.empresas(this.ctx(s))).map((e) => ({ codigo: e.codigo, rotulo: e.rotulo }));
  }

  /** Os S-2210 do acidente na fila, de todas as situações (o original, o retificador e o descartado ficam guardados). */
  async eventosCat(s: SessaoCadastro, acidente: number): Promise<RegistroEventoEsocial[]> {
    return this.porta.eventos(this.ctx(s), { evento: 'S-2210', origem: 'acidente', referencia: acidente });
  }

  /**
   * O S-2210 do acidente (prévia ou gravado): o original, ou a retificação (indRetif 2 com o recibo) do S-2210 aceito,
   * que substitui o evento inteiro. Só vai à fila: a transmissão segue o lote e fica desligada fora de produção.
   */
  async gerarCat(
    s: SessaoCadastro,
    x: {
      readonly empresa: number;
      readonly vinculo: number;
      readonly cat: CatParaEvento;
      readonly retificar: RegistroEventoEsocial | null;
      readonly gravar: boolean;
    },
  ): Promise<ResultadoGeracaoEsocial> {
    if (x.gravar) await this.apoio.exigirLiberacao(s);
    const r = x.retificar;
    if (
      r &&
      (r.evento !== 'S-2210' ||
        r.situacao !== 'aceito' ||
        !r.recibo ||
        r.vinculo !== x.vinculo ||
        r.referencia !== x.cat.id)
    )
      throw recusa('evento-sem-recibo', 'Só se retifica o S-2210 aceito, com recibo, deste mesmo acidente.');
    const v = await this.vinculoOu404(s, x.vinculo);
    const data = x.cat.ocorridoEm.slice(0, 10);
    const emp = await this.empregadorPara(s, x.empresa, data.slice(0, 7));
    const t = await this.trabalhadorPara(s, v, data);
    const m = montarS2210(this.contexto(emp.leiaute), emp, t, x.cat, r?.recibo ?? null);
    const conf = await this.conferir(m, 'S-2210', emp.leiaute);
    const montado: EventoMontado = {
      evento: 'S-2210',
      operacao: null,
      origem: 'acidente',
      referencia: x.cat.id,
      vinculo: v.id,
      montagem: m,
      valido: conf.valido,
      errosXsd: conf.erros,
      eventoAnterior: r?.id ?? null,
    };
    if (!x.gravar) return this.resultado([montado], null, false);
    const ids = await this.gravarEventos(s, x.empresa, emp.leiaute, [montado], true);
    return this.resultado([montado], ids, false);
  }

  // ── Consulta, descarte e exclusão ───────────────────────────────────────────────────────────────────────────

  private async matriculas(
    s: SessaoCadastro,
    xs: readonly RegistroEventoEsocial[],
  ): Promise<Map<number, string | null>> {
    const ids = [...new Set(xs.map((x) => x.vinculo).filter((v): v is number => v !== null))].slice(0, 200);
    const vs = await Promise.all(ids.map((id) => this.pessoas.vinculo(s.porta, id)));
    return new Map(vs.filter((v): v is VinculoDoCadastro => !!v).map((v) => [v.id, v.matricula]));
  }

  async listarEventos(s: SessaoCadastro, f: FiltroEventosEsocial): Promise<ListaEventosEsocial> {
    const xs = await this.porta.eventos(this.ctx(s), {
      ...(f.empresa !== undefined ? { empresa: f.empresa } : {}),
      ...(f.evento !== undefined ? { evento: f.evento } : {}),
      ...(f.situacao !== undefined ? { situacao: f.situacao } : {}),
      ...(f.vinculo !== undefined ? { vinculo: f.vinculo } : {}),
      ...(f.lote !== undefined ? { lote: f.lote } : {}),
      ...(f.de !== undefined ? { de: f.de } : {}),
      ...(f.ate !== undefined ? { ate: f.ate } : {}),
    });
    const lista = xs.slice(0, TETO_EVENTOS_ESOCIAL);
    const mats = await this.matriculas(s, lista);
    return {
      itens: lista.map((x) =>
        paraResumoEsocial(x, x.vinculo === null ? null : (mats.get(x.vinculo) ?? null)),
      ),
      teto: TETO_EVENTOS_ESOCIAL,
      truncado: xs.length > TETO_EVENTOS_ESOCIAL,
    };
  }

  private async eventoOu404(s: SessaoCadastro, id: number) {
    const r = await this.porta.evento(this.ctx(s), id);
    if (!r) throw naoEncontrado('Evento');
    return r;
  }

  /** O evento e o XML (só com `pessoas.esocial.gerar`, decifrado; a rota audita a leitura). */
  async detalheEvento(s: SessaoCadastro, id: number): Promise<DetalheEventoEsocial> {
    const r = await this.eventoOu404(s, id);
    const mats = await this.matriculas(s, [r.evento]);
    const xml = !s.pode(P.gerar)
      ? null
      : r.evento.xmlCifrado
        ? (this.cifra?.decifrarTexto(r.xml) ?? null)
        : r.xml;
    return {
      evento: paraResumoEsocial(
        r.evento,
        r.evento.vinculo === null ? null : (mats.get(r.evento.vinculo) ?? null),
      ),
      xml,
    };
  }

  async descartar(
    s: SessaoCadastro,
    id: number,
    x: DescartarEventoEsocialEntrada,
  ): Promise<EventoEsocialResumo> {
    await this.eventoOu404(s, id);
    await this.apoio.sgh(
      s,
      E.pessoasEsocialEventoDescartado.codigo,
      P.gerar,
      { tabela: 'evento_esocial', id: String(id), chave: 'descarte' },
      async (g) => {
        const [ev] = await g.eventosComTrava([id]);
        if (!ev || ev.versao !== x.versao)
          throw recusa(
            'desatualizado',
            'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
          );
        if (!podeTransitar(ev.situacao, 'descartado'))
          throw recusa(
            'situacao-invalida',
            'Só se descarta evento que ainda não foi enviado (ou que voltou rejeitado).',
          );
        await g.mudarSituacaoEvento({
          id,
          versao: ev.versao,
          situacao: 'descartado',
          motivo: x.motivo,
          por: s.login,
        });
      },
    );
    return (await this.detalheEvento(s, id)).evento;
  }

  /** Exclusão de um evento aceito do trabalhador pelo S-3000 (prévia ou gravado; segue o lote e o retorno). */
  async excluir(
    s: SessaoCadastro,
    id: number,
    x: ExcluirEventoEsocialEntrada,
  ): Promise<ResultadoGeracaoEsocial> {
    if (x.gravar) await this.apoio.exigirLiberacao(s);
    const alvo = (await this.eventoOu404(s, id)).evento;
    if (alvo.versao !== x.versao)
      throw recusa(
        'desatualizado',
        'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
      );
    if (alvo.situacao !== 'aceito')
      throw recusa('evento-sem-recibo', 'Só se exclui evento aceito, com recibo.');
    const relogio = await this.folha.relogio(this.ctx(s));
    const emp = await this.empregadorPara(s, alvo.empresa, relogio.hoje.slice(0, 7));
    let cpf: string | null = null;
    if (alvo.vinculo !== null) {
      const v = await this.vinculoOu404(s, alvo.vinculo);
      cpf = this.exigirCifra().decifrar(v.cpfCifrado);
    }
    const m = montarS3000(
      this.contexto(emp.leiaute),
      emp,
      {
        evento: alvo.evento,
        recibo: alvo.recibo,
        cpf,
        dataReferencia: alvo.dataReferencia,
        // M53-F6: o S-1200 do 13º (período AAAA) é da apuração anual.
        indApuracao: alvo.dataReferencia.length === 4 ? 2 : 1,
      },
      relogio.hoje,
    );
    const conf = await this.conferir(m, 'S-3000', emp.leiaute);
    const montado: EventoMontado = {
      evento: 'S-3000',
      operacao: null,
      origem: 'exclusao',
      referencia: alvo.id,
      vinculo: alvo.vinculo,
      montagem: m,
      valido: conf.valido,
      errosXsd: conf.erros,
      eventoAnterior: alvo.id,
    };
    if (!x.gravar) return this.resultado([montado], null, alvo.vinculo === null);
    const ids = await this.gravarEventos(s, alvo.empresa, emp.leiaute, [montado], alvo.vinculo !== null);
    return this.resultado([montado], ids, alvo.vinculo === null);
  }

  // ── Lotes ───────────────────────────────────────────────────────────────────────────────────────────────────

  async listarLotes(s: SessaoCadastro, f: FiltroLotesEsocial): Promise<ListaLotesEsocial> {
    const xs = await this.porta.lotes(this.ctx(s), {
      ...(f.empresa !== undefined ? { empresa: f.empresa } : {}),
      ...(f.situacao !== undefined ? { situacao: f.situacao } : {}),
    });
    return {
      itens: xs.slice(0, TETO_LOTES_ESOCIAL).map(paraLote),
      teto: TETO_LOTES_ESOCIAL,
      truncado: xs.length > TETO_LOTES_ESOCIAL,
    };
  }

  async detalheLote(s: SessaoCadastro, id: number): Promise<DetalheLoteEsocial> {
    const l = await this.porta.lote(this.ctx(s), id);
    if (!l) throw naoEncontrado('Lote');
    const evs = await this.porta.eventos(this.ctx(s), { lote: id });
    const mats = await this.matriculas(s, evs);
    return {
      lote: paraLote(l),
      eventos: evs.map((x) =>
        paraResumoEsocial(x, x.vinculo === null ? null : (mats.get(x.vinculo) ?? null)),
      ),
    };
  }

  /** Monta o lote: 1 a 50 eventos validados do mesmo empregador e grupo; o transmissor tem de ser o Sante SGH. */
  async montarLote(s: SessaoCadastro, x: MontarLoteEsocialEntrada): Promise<DetalheLoteEsocial> {
    const relogio = await this.folha.relogio(this.ctx(s));
    await this.empregadorPara(s, x.empresa, relogio.hoje.slice(0, 7));
    const ambiente = ambienteDoLote(this.ambiente);
    const id = await this.apoio.sgh(
      s,
      E.pessoasEsocialLoteGravado.codigo,
      P.transmitir,
      (r: number) => ({ tabela: 'lote_esocial', id: String(r), chave: 'montado' }),
      async (g) => {
        const evs = await g.eventosComTrava([...new Set(x.eventos)]);
        if (evs.length !== new Set(x.eventos).size) throw naoEncontrado('Evento');
        const c = conferirLote(x.empresa, evs);
        if (!c.ok)
          throw recusa(
            c.codigo,
            c.codigo === 'lote-misto'
              ? 'O lote leva eventos do mesmo empregador e do mesmo grupo (tabela, não periódicos ou periódicos).'
              : c.codigo === 'situacao-invalida'
                ? 'Só entram no lote eventos validados que ainda não estão em outro lote.'
                : 'O lote leva de 1 a 50 eventos.',
            { eventos: c.ids },
          );
        const lote = await g.incluirLote({
          empresa: x.empresa,
          grupo: c.grupo,
          ambiente,
          quantidade: evs.length,
          por: s.login,
        });
        for (const ev of evs)
          await g.mudarSituacaoEvento({
            id: ev.id,
            versao: ev.versao,
            situacao: 'em-lote',
            lote,
            por: s.login,
          });
        return lote;
      },
    );
    return this.detalheLote(s, id);
  }

  private motivoEnvio(d: { readonly codigo: string; readonly motivo: string }): string {
    return d.codigo === 'transmissor-real-indisponivel' ? (this.transmissao.motivo ?? d.motivo) : d.motivo;
  }

  private async decisaoEnvio(s: SessaoCadastro) {
    const chave = await this.apoioTransmissao.liberacao(s);
    const d = decidirEnvio(this.ambiente, chave.ligada, this.transmissao.transmissor !== null);
    if (!d.ok) throw recusa(d.codigo, this.motivoEnvio(d));
    return d;
  }

  private async transmitir<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroTransmissorEsocial) throw recusa(e.codigo, e.message);
      throw e;
    }
  }

  /** Os eventos do lote prontos para a transmissão real: o Id e o XML gravado (decifrado). */
  private async eventosParaTransmitir(s: SessaoCadastro, id: number) {
    const c = this.ctx(s);
    const lote = await this.porta.lote(c, id);
    if (!lote) throw naoEncontrado('Lote');
    const cnpj = (await this.porta.cnpjs(c)).get(lote.empresa);
    if (!cnpj) throw recusa('empresa-sem-cnpj', 'A empresa do lote não tem CNPJ no cadastro.');
    // Na ordem em que foram gerados (o S-1000 antes das demais tabelas; a retificação depois do original).
    const evs = (await this.porta.eventos(c, { lote: id })).sort((x, y) => x.id - y.id);
    const eventos: { evento: number; envio: EventoParaTransmitir }[] = [];
    for (const ev of evs) {
      const r = await this.eventoOu404(s, ev.id);
      const xml = r.evento.xmlCifrado ? this.exigirCifra().decifrarTexto(r.xml) : r.xml;
      if (!xml) throw recusa('xml-ilegivel', `O XML do evento ${ev.id} não pôde ser lido.`);
      eventos.push({ evento: ev.id, envio: { id: ev.idEsocial, xml } });
    }
    return { lote, empregador: raizCnpj(cnpj), eventos };
  }

  /**
   * Envia o lote: fora de `producao`, ao coletor local (nada sai da máquina; regra 3); em `producao`, só com a chave
   * `pessoas.esocial` ligada e o transmissor real (certificado conferido): cada evento assinado com o A1, o lote pelo
   * serviço de envio e o protocolo gravado. D-ENVIO-536 (POL-5): a chamada ao serviço acontece dentro da transação, com
   * o lote travado (ninguém envia o mesmo lote duas vezes); recusa do eSocial ou falha de rede desfaz tudo.
   */
  async enviarLote(s: SessaoCadastro, id: number, x: EnviarLoteEsocialEntrada): Promise<DetalheLoteEsocial> {
    const d = await this.decisaoEnvio(s);
    const t = d.ambiente === 'producao' ? this.transmissao.transmissor : null;
    const real = t ? await this.eventosParaTransmitir(s, id) : null;
    await this.apoio.sgh(
      s,
      E.pessoasEsocialLoteGravado.codigo,
      P.transmitir,
      { tabela: 'lote_esocial', id: String(id), chave: 'enviado' },
      async (g) => {
        const l = await g.loteComTrava(id);
        if (!l) throw naoEncontrado('Lote');
        if (l.versao !== x.versao)
          throw recusa(
            'desatualizado',
            'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
          );
        if (l.situacao !== 'montado') throw recusa('situacao-invalida', 'Só se envia lote montado.');
        const evs = await g.eventos({ lote: id });
        let protocolo = `${d.ambiente.toUpperCase()}-${id}`;
        if (t && real) {
          const ids = new Set(real.eventos.map((e) => e.evento));
          if (evs.length !== ids.size || evs.some((e) => !ids.has(e.id)))
            throw recusa(
              'desatualizado',
              'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
            );
          const r = await this.transmitir(() =>
            t.enviarLote({
              grupo: NUMERO_GRUPO_ESOCIAL[l.grupo],
              empregador: real.empregador,
              eventos: real.eventos.map((e) => e.envio),
            }),
          );
          if (r.codigo !== 201 || !r.protocolo)
            throw recusa(
              'lote-recusado-esocial',
              `O eSocial não recebeu o lote (${r.codigo}): ${resumoOcorrencias(r.descricao, r.ocorrencias).slice(0, 300)}`,
            );
          protocolo = r.protocolo;
        }
        await g.mudarSituacaoLote({
          id,
          versao: l.versao,
          situacao: 'enviado',
          protocolo,
          enviado: true,
          por: s.login,
        });
        for (const ev of evs)
          await g.mudarSituacaoEvento({ id: ev.id, versao: ev.versao, situacao: 'enviado', por: s.login });
      },
    );
    return this.detalheLote(s, id);
  }

  async cancelarLote(
    s: SessaoCadastro,
    id: number,
    x: CancelarLoteEsocialEntrada,
  ): Promise<DetalheLoteEsocial> {
    await this.apoio.sgh(
      s,
      E.pessoasEsocialLoteGravado.codigo,
      P.transmitir,
      { tabela: 'lote_esocial', id: String(id), chave: 'cancelado' },
      async (g) => {
        const l = await g.loteComTrava(id);
        if (!l) throw naoEncontrado('Lote');
        if (l.versao !== x.versao)
          throw recusa(
            'desatualizado',
            'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
          );
        if (l.situacao !== 'montado')
          throw recusa('situacao-invalida', 'Só se cancela lote que ainda não foi enviado.');
        const evs = await g.eventos({ lote: id });
        await g.mudarSituacaoLote({
          id,
          versao: l.versao,
          situacao: 'cancelado',
          motivo: x.motivo,
          por: s.login,
        });
        for (const ev of evs)
          await g.mudarSituacaoEvento({
            id: ev.id,
            versao: ev.versao,
            situacao: 'validado',
            lote: null,
            por: s.login,
          });
      },
    );
    return this.detalheLote(s, id);
  }

  /**
   * Consulta o retorno do lote no serviço do eSocial pelo protocolo (só em `producao`, com o transmissor real) e o
   * registra evento a evento como `registrarRetorno`: aceito com o recibo devolvido, rejeitado com o código e a
   * descrição da ocorrência (sem número longo nem valor entre aspas). Lote ainda em processamento: recusa com o aviso.
   */
  async consultarRetorno(
    s: SessaoCadastro,
    id: number,
    x: EnviarLoteEsocialEntrada,
  ): Promise<DetalheLoteEsocial> {
    const d = await this.decisaoEnvio(s);
    const t = this.transmissao.transmissor;
    if (d.ambiente !== 'producao' || !t)
      throw recusa('consulta-so-em-producao', 'No coletor local o retorno é registrado evento a evento.');
    const c = this.ctx(s);
    const l = await this.porta.lote(c, id);
    if (!l) throw naoEncontrado('Lote');
    if (l.situacao !== 'enviado' || !l.protocolo)
      throw recusa('situacao-invalida', 'Só se consulta o retorno de lote enviado.');
    const protocolo = l.protocolo;
    const r = await this.transmitir(() => t.consultarLote(protocolo));
    if (loteEmProcessamento(r.codigo))
      throw recusa(
        'lote-em-processamento',
        'O eSocial ainda está processando o lote. Consulte de novo em alguns minutos.',
      );
    if (r.codigo !== 201 && r.codigo !== 202)
      throw recusa(
        'lote-com-erro-esocial',
        `O eSocial devolveu o lote com erro (${r.codigo}): ${resumoOcorrencias(r.descricao, r.ocorrencias).slice(0, 300)}`,
      );
    const porIdEsocial = new Map((await this.porta.eventos(c, { lote: id })).map((e) => [e.idEsocial, e]));
    const eventos = r.eventos.flatMap((ret) => {
      const ev = porIdEsocial.get(ret.id);
      if (!ev || ev.situacao !== 'enviado') return [];
      const aceito = eventoAceito(ret);
      const oc = ret.ocorrencias[0];
      return [
        {
          evento: ev.id,
          aceito,
          recibo: aceito ? ret.recibo : null,
          codigo: (oc?.codigo || String(ret.codigo)).slice(0, 10),
          descricao: resumoOcorrencias(ret.descricao, ret.ocorrencias).slice(0, 400) || String(ret.codigo),
        },
      ];
    });
    if (eventos.length === 0)
      throw recusa('retorno-sem-eventos', 'O retorno do eSocial não trouxe os eventos deste lote.');
    return this.registrarRetorno(s, id, { versao: x.versao, protocolo, eventos });
  }

  /**
   * O retorno do processamento do lote, evento a evento (D-RETORNO-536: registrado pelo DP a partir do retorno do
   * coletor ou do eSocial; nenhum recibo é inventado). Aceito: o evento ganha o recibo; a retificação aceita troca a
   * anterior (`substituido`) e o S-3000 aceito exclui o alvo (`excluido`). Todos com retorno: o lote fica processado.
   */
  async registrarRetorno(
    s: SessaoCadastro,
    id: number,
    x: RetornoLoteEsocialEntrada,
  ): Promise<DetalheLoteEsocial> {
    await this.apoio.sgh(
      s,
      E.pessoasEsocialLoteGravado.codigo,
      P.transmitir,
      { tabela: 'lote_esocial', id: String(id), chave: 'retorno' },
      async (g) => {
        const l = await g.loteComTrava(id);
        if (!l) throw naoEncontrado('Lote');
        if (l.versao !== x.versao)
          throw recusa(
            'desatualizado',
            'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
          );
        if (l.situacao !== 'enviado')
          throw recusa('situacao-invalida', 'Só se registra o retorno de lote enviado.');
        const doLote = await g.eventosComTrava((await g.eventos({ lote: id })).map((e) => e.id));
        const porId = new Map(doLote.map((e) => [e.id, e]));
        for (const r of x.eventos) {
          const ev = porId.get(r.evento);
          if (!ev) throw recusa('evento-fora-do-lote', `O evento ${r.evento} não está neste lote.`);
          if (ev.situacao !== 'enviado')
            throw recusa('situacao-invalida', `O evento ${r.evento} já tem retorno.`);
          await g.mudarSituacaoEvento({
            id: ev.id,
            versao: ev.versao,
            situacao: r.aceito ? 'aceito' : 'rejeitado',
            recibo: r.aceito ? r.recibo : null,
            retorno: { codigo: r.codigo, descricao: r.descricao },
            por: s.login,
          });
          porId.set(ev.id, { ...ev, situacao: r.aceito ? 'aceito' : 'rejeitado', versao: ev.versao + 1 });
          if (r.aceito && ev.eventoAnterior !== null) {
            const [ant] = await g.eventosComTrava([ev.eventoAnterior]);
            const para = ev.evento === 'S-3000' ? 'excluido' : 'substituido';
            if (ant && podeTransitar(ant.situacao, para))
              await g.mudarSituacaoEvento({ id: ant.id, versao: ant.versao, situacao: para, por: s.login });
          }
        }
        if ([...porId.values()].every((e) => e.situacao !== 'enviado'))
          await g.mudarSituacaoLote({
            id,
            versao: l.versao,
            situacao: 'processado',
            ...(x.protocolo ? { protocolo: x.protocolo } : {}),
            por: s.login,
          });
      },
    );
    return this.detalheLote(s, id);
  }

  // ── Pendências do outro sistema e conciliação ───────────────────────────────────────────────────────────────

  async pendenciasMigradas(s: SessaoCadastro, empresa: number | null): Promise<PendenciasLegadoEsocial> {
    return painelPendenciasLegado(await this.porta.pendenciasMigradas(this.ctx(s), empresa));
  }

  private async calcularConciliacao(
    s: SessaoCadastro,
    f: FiltroConciliacaoEsocial,
    externo: Readonly<Record<string, number>> | null,
  ): Promise<Omit<ConciliacaoEsocial, 'conferida'>> {
    await this.exigirEmpresa(s, f.empresa);
    const c = this.ctx(s);
    const [vs, cnpjs, pend] = await Promise.all([
      this.vigencias(s),
      this.porta.cnpjs(c),
      this.porta.pendenciasMigradas(c, f.empresa),
    ]);
    const mesmaRaiz = empresasDaMesmaRaiz(cnpjs, f.empresa);
    const empresas = [f.empresa, ...mesmaRaiz];
    const [sante, recibos, ultima] = await Promise.all([
      this.porta.contagemEventos(c, empresas, f.competencia, `${f.competencia}-31`, SITUACOES_TRANSMITIDAS),
      Promise.all(empresas.map((e) => this.porta.recibosAutonomo(c, e, f.competencia))),
      externo === null ? this.porta.ultimaConciliacao(c, f.empresa, f.competencia) : Promise.resolve(null),
    ]);
    const externoUsado: Record<string, number> = externo
      ? { ...externo }
      : ultima
        ? Object.fromEntries(
            (JSON.parse(ultima.linhas) as LinhaConciliacaoEsocial[])
              .filter((l) => l.externo !== null)
              .map((l) => [l.evento, l.externo!]),
          )
        : {};
    const pendencias: Record<string, number> = {};
    for (const p of pend) pendencias[p.evento] = (pendencias[p.evento] ?? 0) + p.quantidade;
    return conciliar({
      empresa: f.empresa,
      competencia: f.competencia,
      decisao: decidirTransmissor(vs, cnpjs, f.empresa, f.competencia),
      mesmaRaiz,
      sante,
      externo: externoUsado,
      repasse: recibos.reduce((a, b) => a + b, 0),
      pendenciasLegado: pendencias,
    });
  }

  async conciliacao(s: SessaoCadastro, f: FiltroConciliacaoEsocial): Promise<ConciliacaoEsocial> {
    const [r, ultima] = await Promise.all([
      this.calcularConciliacao(s, f, null),
      this.porta.ultimaConciliacao(this.ctx(s), f.empresa, f.competencia),
    ]);
    return {
      ...r,
      conferida: ultima
        ? {
            por: ultima.conferidoPor,
            em: ultima.conferidoEm,
            observacao: ultima.observacao,
            situacao: ultima.situacao,
          }
        : null,
    };
  }

  /** Grava a conferência da competência (as linhas com a quantidade que o sistema externo informou). */
  async conferirConciliacao(
    s: SessaoCadastro,
    x: ConferirConciliacaoEsocialEntrada,
  ): Promise<ConciliacaoEsocial> {
    const r = await this.calcularConciliacao(s, x, x.externo);
    await this.apoio.sgh(
      s,
      E.pessoasEsocialConciliacaoConferida.codigo,
      P.transmitir,
      (id: number) => ({
        tabela: 'conciliacao_esocial',
        id: String(id),
        chave: `${x.empresa}:${x.competencia}`,
      }),
      (g) =>
        g.incluirConciliacao({
          empresa: x.empresa,
          competencia: x.competencia,
          transmissor: r.transmissor,
          situacao: r.situacao,
          linhas: JSON.stringify(r.linhas),
          observacao: x.observacao,
          por: s.login,
        }),
    );
    return this.conciliacao(s, x);
  }
}

/** Pendências de dado da montagem (para a tela e os testes). */
export const pendenciasDe = (m: ResultadoEventoEsocial): readonly PendenciaEsocial[] =>
  m.ok ? [] : m.pendencias;
