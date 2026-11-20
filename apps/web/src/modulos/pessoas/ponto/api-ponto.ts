// Cliente das telas do ponto (M52.4): apoio, busca do colaborador, arquivo do relógio, painel do período, espelho,
// ajustes e decisão, fechamento e reabertura, acerto e regra do banco de horas, o próprio espelho com a ciência e os
// arquivos (espelho em PDF, AEJ e eventos para a folha). As gravações vão com o CSRF e a Idempotency-Key (uma por
// intenção); Problem Details viram ErroApi com o código da recusa. As respostas seguem os tipos de @sgh/contratos.
import type {
  AcertoBancoEntrada,
  ApoioPonto,
  ArquivoAfdDetalhe,
  CienciaEspelhoEntrada,
  ColaboradorPonto,
  EspelhoPonto,
  FecharPeriodoEntrada,
  FiltroArquivosAfdEntrada,
  FiltroPontoEntrada,
  ImportarAfdEntrada,
  LancarAjusteEntrada,
  ListaArquivosAfd,
  MeuEspelho,
  PainelPonto,
  ReabrirPeriodoEntrada,
  RegraBancoEntrada,
  RegrasBancoLista,
  ResultadoImportacaoAfd,
  ResultadoPonto,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const P = '/api/pessoas/ponto';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const ok = () => confiar<ResultadoPonto>();

export const lerApoioPonto = (): Promise<ApoioPonto> => ler(`${P}/apoio`, confiar<ApoioPonto>());

export const buscarColaboradoresPonto = (termo: string): Promise<{ itens: ColaboradorPonto[] }> =>
  ler(`${P}/colaboradores${qs({ termo, estado: 'todos' })}`, confiar<{ itens: ColaboradorPonto[] }>());

export const lerArquivosAfd = (f: Partial<FiltroArquivosAfdEntrada> = {}): Promise<ListaArquivosAfd> =>
  ler(
    `${P}/arquivos${qs({ situacao: f.situacao, de: f.de, ate: f.ate, pagina: f.pagina, limite: f.limite })}`,
    confiar<ListaArquivosAfd>(),
  );

export const lerArquivoAfd = (id: number): Promise<ArquivoAfdDetalhe> =>
  ler(`${P}/arquivos/${id}`, confiar<ArquivoAfdDetalhe>());

export const importarAfd = (e: ImportarAfdEntrada): Promise<ResultadoImportacaoAfd> =>
  enviar(`${P}/arquivos`, e, confiar<ResultadoImportacaoAfd>(), novaChave('ponto.afd'));

export const lerPainelPonto = (
  f: Partial<FiltroPontoEntrada> & { competencia: string },
): Promise<PainelPonto> =>
  ler(
    `${P}/painel${qs({
      competencia: f.competencia,
      termo: f.termo,
      unidade: f.unidade,
      situacao: f.situacao,
      pagina: f.pagina,
      limite: f.limite,
    })}`,
    confiar<PainelPonto>(),
  );

export const lerEspelho = (vinculo: number, competencia: string): Promise<EspelhoPonto> =>
  ler(`${P}/espelho/${vinculo}/${competencia}`, confiar<EspelhoPonto>());

export const lancarAjuste = (e: LancarAjusteEntrada): Promise<ResultadoPonto> =>
  enviar(`${P}/ajustes`, e, ok(), novaChave('ponto.ajuste'));

export const decidirAjuste = (
  id: number,
  decisao: 'aprovar' | 'recusar',
  motivo: string | null,
): Promise<ResultadoPonto> =>
  enviar(`${P}/ajustes/${id}/decisao`, { decisao, motivo }, ok(), novaChave('ponto.decisao'));

export const fecharPeriodo = (e: FecharPeriodoEntrada): Promise<ResultadoPonto> =>
  enviar(`${P}/fechamento`, e, ok(), novaChave('ponto.fechar'));

export const reabrirPeriodo = (e: ReabrirPeriodoEntrada): Promise<ResultadoPonto> =>
  enviar(`${P}/reabertura`, e, ok(), novaChave('ponto.reabrir'));

export const acertarBanco = (e: AcertoBancoEntrada): Promise<ResultadoPonto> =>
  enviar(`${P}/banco/acerto`, e, ok(), novaChave('ponto.acerto'));

export const lerRegrasBanco = (): Promise<RegrasBancoLista> =>
  ler(`${P}/regras-banco`, confiar<RegrasBancoLista>());

export const gravarRegraBanco = (e: RegraBancoEntrada): Promise<ResultadoPonto> =>
  enviar(`${P}/regras-banco`, e, ok(), novaChave('ponto.regra'));

export const lerMeuEspelho = (competencia: string | null, vinculo: number | null): Promise<MeuEspelho> =>
  ler(`${P}/meu${qs({ competencia, vinculo })}`, confiar<MeuEspelho>());

export const darCiencia = (e: CienciaEspelhoEntrada): Promise<ResultadoPonto> =>
  enviar(`${P}/meu/ciencia`, e, ok(), novaChave('ponto.ciencia'));

export const urlEspelhoPdf = (vinculo: number, competencia: string) =>
  `${P}/espelho/${vinculo}/${competencia}/pdf`;
export const urlMeuEspelhoPdf = (competencia: string, vinculo: number) =>
  `${P}/meu/pdf${qs({ competencia, vinculo })}`;
export const urlAej = (competencia: string) => `${P}/aej${qs({ competencia })}`;
export const urlEventosFolha = (competencia: string) => `${P}/eventos-folha${qs({ competencia })}`;

// ── W0-06 (programa CRUD completo) ──
/** O próprio solicitante desiste do ajuste pendente, com o motivo. */
export const desistirAjuste = (id: number, motivo: string): Promise<ResultadoPonto> =>
  enviar(`${P}/ajustes/${id}/desistencia`, { motivo }, ok(), novaChave('ponto.ajuste.desist'));
/** Desativa ou reativa a regra do banco de horas do regime, com o motivo e a versão lida. */
export const situacaoRegraBanco = (
  regime: number,
  e: { versao: number; ativo: boolean; motivo: string },
): Promise<ResultadoPonto> =>
  enviar(`${P}/regras-banco/${regime}/situacao`, e, ok(), novaChave('ponto.regra.sit'));
