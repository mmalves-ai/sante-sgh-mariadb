// Cliente das telas da cirurgia segura e do rastreio no bloco (M46, etapa 2: checklist, quadro do bloco, rastreio e o
// painel para familiares). As leituras vêm tipadas pelos contratos; as gravações levam o CSRF e a Idempotency-Key, que
// vai também no corpo como `chave` (o mesmo pedido reenviado não grava duas vezes). O painel para familiares entra pelo
// token do aparelho (perfil Painel/Totem), nunca pela sessão de pessoa.
import type {
  DominiosRastreioResposta,
  PainelFamiliaResposta,
  QuadroBlocoResposta,
  ResultadoBlocoSeguro,
  TelaChecklistResposta,
  TelaRastreioResposta,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChaveAnestesia } from './api-anestesia.js';

const B = '/api/cirurgia/bloco';
const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string, cabecalhos: Record<string, string> = {}): Promise<T> {
  const r = await fetch(url, { headers: { ...JSON_ACEITO, ...cabecalhos } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export async function gravarBloco(
  url: string,
  corpo: Record<string, unknown>,
  chave: string = novaChaveAnestesia('bloco'),
): Promise<ResultadoBlocoSeguro> {
  const r = await fetch(`${B}${url}`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify({ ...corpo, chave }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as ResultadoBlocoSeguro;
}

const qs = (o: Record<string, string | null | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return p.length ? `?${new URLSearchParams(p as [string, string][]).toString()}` : '';
};

export const lerQuadroBloco = (data: string | null, sala: string | null) =>
  ler<QuadroBlocoResposta>(`${B}/quadro${qs({ data, sala })}`);
export const lerCirurgiasChecklist = (data: string | null) =>
  ler<QuadroBlocoResposta>(`${B}/checklist/cirurgias${qs({ data })}`);
export const lerChecklist = (agenda: number) => ler<TelaChecklistResposta>(`${B}/${agenda}/checklist`);
export const lerRastreio = (agenda: number) => ler<TelaRastreioResposta>(`${B}/${agenda}/rastreio`);
export const lerDominiosRastreio = () => ler<DominiosRastreioResposta>(`${B}/dominios`);
/** O canal de eventos do quadro do bloco (só avisa "mudou"; a tela relê). */
export const CANAL_QUADRO_BLOCO = `${B}/quadro/eventos`;

/** O painel para familiares pelo token do aparelho (cabeçalho do dispositivo; sem sessão de pessoa). */
export const lerPainelFamilia = (token: string) =>
  ler<PainelFamiliaResposta>('/api/dispositivo/bloco-familia', { 'x-sgh-dispositivo': token });
