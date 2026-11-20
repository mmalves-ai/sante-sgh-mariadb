// Cliente da escala de plantão e dos regimes, fatia F2 (M52.2): apoio, regimes (inclusão, alteração e a vigência do
// colaborador), escalas (lista, criação, grade), plantões (inclusão, alteração, cancelamento), cobertura e publicação.
// As gravações vão com o CSRF e a Idempotency-Key (uma por intenção); Problem Details viram ErroApi com o código da
// recusa em `problema.codigo`. As respostas seguem os tipos de @sgh/contratos.
import type {
  AlterarCoberturaEntrada,
  AlterarPlantaoEntrada,
  AlterarRegimeEntrada,
  ApoioEscala,
  AtribuirRegimeEntrada,
  CancelarPlantaoEntrada,
  CriarEscalaEntrada,
  FiltroEscalasEntrada,
  GradeEscala,
  IncluirPlantaoEntrada,
  IncluirRegimeEntrada,
  ListaColaboradoresEscala,
  ListaEscalas,
  ListaRegimes,
  PublicarEscalaEntrada,
  ResultadoEscala,
  VigenciaRegime,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const P = '/api/pessoas';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoEscala>();
type SemEscala<T> = Omit<T, 'escala'>;

export const lerApoioEscala = (): Promise<ApoioEscala> => ler(`${P}/escala/apoio`, confiar<ApoioEscala>());
export const lerApoioRegimes = (): Promise<ApoioEscala> => ler(`${P}/regimes/apoio`, confiar<ApoioEscala>());

export const lerRegimes = (): Promise<ListaRegimes> => ler(`${P}/regimes`, confiar<ListaRegimes>());
export const incluirRegime = (e: IncluirRegimeEntrada): Promise<ResultadoEscala> =>
  enviar(`${P}/regimes`, e, resultado, novaChave('pessoas.regime'));
export const alterarRegime = (e: AlterarRegimeEntrada): Promise<ResultadoEscala> => {
  const { id, ...resto } = e;
  return enviar(`${P}/regimes/${id}`, resto, resultado, novaChave('pessoas.regime.alt'));
};
export const atribuirRegime = (e: AtribuirRegimeEntrada): Promise<ResultadoEscala> =>
  enviar(`${P}/regimes/atribuicao`, e, resultado, novaChave('pessoas.regime.atr'));

export const lerColaboradoresEscala = (
  termo: string,
  origem: 'escala' | 'regimes' = 'escala',
): Promise<ListaColaboradoresEscala> =>
  ler(
    `${P}/${origem === 'escala' ? 'escala' : 'regimes'}/colaboradores${qs({ termo: termo || undefined, limite: 200 })}`,
    confiar<ListaColaboradoresEscala>(),
  );
export const lerVigencias = (vinculo: number): Promise<VigenciaRegime[]> =>
  ler(`${P}/regimes/colaboradores/${vinculo}`, z.array(confiar<VigenciaRegime>()));

export const lerEscalas = (f: Partial<FiltroEscalasEntrada>): Promise<ListaEscalas> =>
  ler(
    `${P}/escalas${qs({ competencia: f.competencia, unidade: f.unidade, tipo: f.tipo, estado: f.estado })}`,
    confiar<ListaEscalas>(),
  );
export const criarEscala = (e: CriarEscalaEntrada): Promise<ResultadoEscala> =>
  enviar(`${P}/escalas`, e, resultado, novaChave('pessoas.escala'));
export const lerGrade = (escala: number): Promise<GradeEscala> =>
  ler(`${P}/escalas/${escala}`, confiar<GradeEscala>());
export const alterarCobertura = (
  escala: number,
  e: SemEscala<AlterarCoberturaEntrada>,
): Promise<ResultadoEscala> =>
  enviar(`${P}/escalas/${escala}/cobertura`, e, resultado, novaChave('pessoas.escala.cob'));
export const incluirPlantao = (
  escala: number,
  e: SemEscala<IncluirPlantaoEntrada>,
): Promise<ResultadoEscala> =>
  enviar(`${P}/escalas/${escala}/plantoes`, e, resultado, novaChave('pessoas.plantao'));
export const alterarPlantao = (
  escala: number,
  e: Omit<AlterarPlantaoEntrada, 'escala'>,
): Promise<ResultadoEscala> => {
  const { plantao, ...resto } = e;
  return enviar(
    `${P}/escalas/${escala}/plantoes/${plantao}`,
    resto,
    resultado,
    novaChave('pessoas.plantao.alt'),
  );
};
export const cancelarPlantao = (
  escala: number,
  e: Omit<CancelarPlantaoEntrada, 'escala'>,
): Promise<ResultadoEscala> => {
  const { plantao, ...resto } = e;
  return enviar(
    `${P}/escalas/${escala}/plantoes/${plantao}/cancelamento`,
    resto,
    resultado,
    novaChave('pessoas.plantao.canc'),
  );
};
export const publicarEscala = (
  escala: number,
  e: SemEscala<PublicarEscalaEntrada>,
): Promise<ResultadoEscala> =>
  enviar(`${P}/escalas/${escala}/publicacao`, e, resultado, novaChave('pessoas.escala.pub'));

// ── W0-06 (programa CRUD completo) ──
/** Exclui a escala em rascunho criada por engano (só sem vínculo; o retrato de cada linha fica guardado). */
export const excluirEscala = (
  escala: number,
  e: { versao: number; motivo: string },
): Promise<ResultadoEscala> =>
  enviar(`${P}/escalas/${escala}/exclusao`, e, resultado, novaChave('pessoas.escala.exc'));
/** Cancela a escala publicada com o motivo (os plantões previstos ficam cancelados). */
export const cancelarEscala = (
  escala: number,
  e: { versao: number; motivo: string },
): Promise<ResultadoEscala> =>
  enviar(`${P}/escalas/${escala}/cancelamento`, e, resultado, novaChave('pessoas.escala.canc'));
/** Anula a vigência de regime lançada por engano (fica no histórico). */
export const anularVigencia = (vigencia: number, motivo: string): Promise<ResultadoEscala> =>
  enviar(
    `${P}/regimes/vigencias/${vigencia}/anulacao`,
    { motivo },
    resultado,
    novaChave('pessoas.regime.anul'),
  );
