// Cliente das telas do SESMT (M52.5): apoio e busca do colaborador por tela, painel de pendências, prontuário
// ocupacional e ASO, vacinas, acidentes e CAT, mapa de riscos, EPI do colaborador e os documentos. As gravações vão
// com o CSRF e a Idempotency-Key (uma por intenção); Problem Details viram ErroApi com o código da recusa. As respostas
// seguem os tipos de @sgh/contratos (o servidor é a fonte).
import type {
  AcidenteResposta,
  AnularAcidenteEntrada,
  ApoioSesmt,
  BuscaColaboradoresSesmt,
  CarteiraVacinas,
  EmitirCatEntrada,
  EncerrarAcidenteEntrada,
  EncerrarLinhaRiscoEntrada,
  EpiDoColaborador,
  FatoresRisco,
  FiltroSesmtEntrada,
  LinhaRiscoEntrada,
  ListaAcidentes,
  MapaRiscos,
  PainelSesmt,
  ProfilaxiaEntrada,
  ProntuarioOcupacional,
  RegistrarAcidenteEntrada,
  RegistrarAsoEntrada,
  RegistrarVacinaColaboradorEntrada,
  RegistroEpiEntrada,
  ResultadoGeracaoEsocial,
  ResultadoSesmt,
  RetificarAcidenteEntrada,
  SorologiaEntrada,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';
import { semVinculo } from '../comum.js';

const P = '/api/pessoas/sesmt';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const ok = () => confiar<ResultadoSesmt>();

export type TelaSesmt = 'aso' | 'cat' | 'riscos' | 'vacinas';

export const lerApoioSesmt = (tela: TelaSesmt): Promise<ApoioSesmt> =>
  ler(`${P}/${tela}/apoio`, confiar<ApoioSesmt>());

export const buscarColaboradoresSesmt = (
  tela: TelaSesmt,
  termo: string,
  estado: 'ativo' | 'desligado' | 'todos' = 'todos',
): Promise<BuscaColaboradoresSesmt> =>
  ler(`${P}/${tela}/colaboradores${qs({ termo, estado })}`, confiar<BuscaColaboradoresSesmt>());

export const lerPainelSesmt = (f: Partial<FiltroSesmtEntrada>): Promise<PainelSesmt> =>
  ler(
    `${P}/painel${qs({
      termo: f.termo,
      unidade: f.unidade,
      pendencia: f.pendencia,
      somentePendentes: f.somentePendentes === undefined ? undefined : String(f.somentePendentes),
      pagina: f.pagina,
      limite: f.limite,
    })}`,
    confiar<PainelSesmt>(),
  );

export const lerProntuario = (vinculo: number): Promise<ProntuarioOcupacional> =>
  ler(`${P}/aso/${vinculo}`, confiar<ProntuarioOcupacional>());

export const registrarAso = (
  vinculo: number,
  e: Omit<RegistrarAsoEntrada, 'vinculo'>,
): Promise<ResultadoSesmt> => enviar(`${P}/aso/${vinculo}`, e, ok(), novaChave('sesmt.aso'));

export const lerCarteira = (vinculo: number): Promise<CarteiraVacinas> =>
  ler(`${P}/vacinas/${vinculo}`, confiar<CarteiraVacinas>());

export const registrarVacina = (
  vinculo: number,
  e: Omit<RegistrarVacinaColaboradorEntrada, 'vinculo'>,
): Promise<ResultadoSesmt> => enviar(`${P}/vacinas/${vinculo}`, e, ok(), novaChave('sesmt.vacina'));

export const lerAcidentes = (
  estado: 'aberto' | 'encerrado' | 'todos',
  depois?: number,
): Promise<ListaAcidentes> =>
  ler(`${P}/acidentes${qs({ estado, depois, limite: 50 })}`, confiar<ListaAcidentes>());

export const lerAcidente = (id: number): Promise<AcidenteResposta> =>
  ler(`${P}/acidentes/${id}`, confiar<AcidenteResposta>());

export const registrarAcidente = (e: RegistrarAcidenteEntrada): Promise<ResultadoSesmt> =>
  enviar(`${P}/acidentes`, e, ok(), novaChave('sesmt.acidente'));

export const registrarProfilaxia = (
  id: number,
  e: Omit<ProfilaxiaEntrada, 'acidente'>,
): Promise<ResultadoSesmt> =>
  enviar(`${P}/acidentes/${id}/profilaxia`, e, ok(), novaChave('sesmt.profilaxia'));

export const registrarSorologia = (
  id: number,
  e: Omit<SorologiaEntrada, 'acidente'>,
): Promise<ResultadoSesmt> => enviar(`${P}/acidentes/${id}/sorologia`, e, ok(), novaChave('sesmt.sorologia'));

export const emitirCat = (id: number, e: Omit<EmitirCatEntrada, 'acidente'>): Promise<ResultadoSesmt> =>
  enviar(`${P}/acidentes/${id}/cat`, e, ok(), novaChave('sesmt.cat'));

export const encerrarAcidente = (
  id: number,
  e: Omit<EncerrarAcidenteEntrada, 'acidente'>,
): Promise<ResultadoSesmt> =>
  enviar(`${P}/acidentes/${id}/encerramento`, e, ok(), novaChave('sesmt.encerrar'));

export const urlCatPdf = (id: number) => `${P}/acidentes/${id}/cat/pdf`;

// W0-06: retificação e anulação do acidente e da CAT (S-2210 retificador ou S-3000 na fila do eSocial; nada sai do
// dev), o S-2210 original e o cancelamento da entrega de EPI, todos com motivo.
export const retificarAcidente = (
  id: number,
  e: Omit<RetificarAcidenteEntrada, 'acidente'>,
): Promise<ResultadoSesmt> =>
  enviar(`${P}/acidentes/${id}/retificacao`, e, ok(), novaChave('sesmt.acidente.retificacao'));

export const anularAcidente = (
  id: number,
  e: Omit<AnularAcidenteEntrada, 'acidente'>,
): Promise<ResultadoSesmt> =>
  enviar(`${P}/acidentes/${id}/anulacao`, e, ok(), novaChave('sesmt.acidente.anulacao'));

export const gerarCatEsocial = (id: number, empresa: number): Promise<ResultadoGeracaoEsocial> =>
  enviar(
    `${P}/acidentes/${id}/esocial`,
    { empresa, gravar: true },
    confiar<ResultadoGeracaoEsocial>(),
    novaChave('sesmt.acidente.esocial'),
  );

export const cancelarEntregaEpi = (id: number, motivo: string): Promise<ResultadoSesmt> =>
  enviar(`${P}/epi/entregas/${id}/cancelamento`, { motivo }, ok(), novaChave('sesmt.epi.cancelamento'));

export const lerMapaRiscos = (funcao: string, vigentes: boolean): Promise<MapaRiscos> =>
  ler(`${P}/riscos${qs({ funcao: funcao || undefined, vigentes: String(vigentes) })}`, confiar<MapaRiscos>());

export const buscarFatores = (termo: string): Promise<FatoresRisco> =>
  ler(`${P}/riscos/fatores${qs({ termo })}`, confiar<FatoresRisco>());

export const incluirLinhaRisco = (e: LinhaRiscoEntrada): Promise<ResultadoSesmt> =>
  enviar(`${P}/riscos`, e, ok(), novaChave('sesmt.risco'));

export const encerrarLinhaRisco = (
  id: number,
  e: Omit<EncerrarLinhaRiscoEntrada, 'id'>,
): Promise<ResultadoSesmt> => enviar(`${P}/riscos/${id}/encerramento`, e, ok(), novaChave('sesmt.risco.fim'));

export const lerEpiDoColaborador = (vinculo: number): Promise<EpiDoColaborador> =>
  ler(`${P}/epi/${vinculo}`, confiar<EpiDoColaborador>());

export const registrarEpi = (vinculo: number, e: RegistroEpiEntrada): Promise<ResultadoSesmt> =>
  enviar(`${P}/epi/${vinculo}`, semVinculo(e), ok(), novaChave(`sesmt.epi.${e.tipo}`));

export const assinarEntrega = (id: number): Promise<ResultadoSesmt> =>
  enviar(`${P}/epi/entregas/${id}/assinatura`, { conferida: true }, ok(), novaChave('sesmt.epi.assinatura'));

export const urlComprovante = (id: number) => `${P}/epi/entregas/${id}/comprovante/pdf`;
/** D-PPP-525: o PPP de consulta do colaborador em PDF/A (leitura auditada). */
export const urlPpp = (vinculo: number) => `${P}/epi/${vinculo}/ppp/pdf`;
