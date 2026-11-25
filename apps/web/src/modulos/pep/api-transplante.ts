// Cliente da API da doação e do transplante de órgãos no prontuário (03-PEP L145):
// GET  /api/pep/transplante/opcoes                 órgãos e tecidos ativos e os parentescos
// GET  /api/pep/transplante/paciente/:paciente     doações e inscrições do paciente nesta unidade
// GET  /api/pep/transplante/receptores?orgao=&doador=
//                                                  receptores da unidade na lista do órgão (sem nome), a partir de
//                                                  uma doação (vínculo com o doador; a consulta vai à trilha)
// POST /api/pep/transplante/<doador|antibiotico|preservacao|receptor|destino|acompanhamento>
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/transplante';
const JSON_ACEITO = { accept: 'application/json' };
const ref = z.object({ id: z.number(), descricao: z.string() });
const s = z.string().nullable();
const n = z.number().nullable();
const falha = z.object({ codigo: z.string(), mensagem: z.string() });

export const esquemaOpcoesTransplante = z.object({
  orgaos: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      tipo: z.string(),
      quantidadePorDoador: z.number(),
    }),
  ),
  parentescos: z.array(ref),
});
export type OpcoesTransplanteTela = z.infer<typeof esquemaOpcoesTransplante>;

const destino = z.object({
  id: z.number(),
  versao: z.number(),
  doador: z.number(),
  receptor: z.number(),
  prontuarioReceptor: s,
  prontuarioDoador: s,
  orgao: ref,
  situacao: z.string(),
  doadorVivoParente: z.boolean(),
  observacao: s,
});
export type DestinoTela = z.infer<typeof destino>;

export const esquemaTransplantePaciente = z.object({
  doacoes: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      tipo: z.string(),
      situacao: z.string(),
      encerrada: z.boolean(),
      consentimento: z.string(),
      consentimentoEm: s,
      responsavelConsentimento: s,
      parentesco: ref.nullable(),
      registroCentral: s,
      causaInternacao: s,
      causaMorte: s,
      morteEncefalicaEm: s,
      internadoEm: s,
      diasTerapiaIntensiva: n,
      pesoKg: n,
      alturaCm: n,
      pressaoArterial: s,
      frequenciaCardiaca: n,
      saturacao: n,
      teveParadaCardiaca: z.boolean(),
      paradaDescricao: s,
      aminasVasoativas: s,
      cirurgiasPrevias: s,
      nutricao: s,
      diagnosticoDiferencial: s,
      captacaoEm: s,
      meioLocomocao: s,
      procedimentoInicioEm: s,
      procedimentoFimEm: s,
      clampeamentoEm: s,
      tipoPerfusao: s,
      observacao: s,
      fechadoEm: s,
      pendencias: z.array(falha),
      antibioticos: z.array(
        z.object({
          id: z.number(),
          versao: z.number(),
          sequencia: z.number(),
          descricao: z.string(),
          inicio: s,
          fim: s,
        }),
      ),
      preservacoes: z.array(
        z.object({
          id: z.number(),
          sequencia: z.number(),
          orgao: ref,
          receptor: n,
          nomeSolucao: z.string(),
          marca: s,
          lote: s,
          validade: s,
          volumeMl: n,
          aplicadaEm: s,
          responsavel: s,
        }),
      ),
      destinos: z.array(destino),
    }),
  ),
  inscricoes: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      orgao: ref,
      cadastradoEm: s,
      situacao: z.string(),
      naLista: z.boolean(),
      apto: z.boolean(),
      motivoAptidao: s,
      aptidaoAlteradaEm: s,
      urgencia: z.boolean(),
      numeroRegistroCentral: s,
      numeroCadastroNacional: s,
      transplantadoEm: s,
      doador: n,
      centroHemodialise: s,
      tipoDialise: s,
      tipoAcessoDialise: s,
      outrosResultados: s,
      acompanhamentos: z.array(
        z.object({
          id: z.number(),
          sequencia: z.number(),
          observadoEm: s,
          dias: n,
          tipo: z.string(),
          descricao: z.string(),
          destaque: z.boolean(),
          profissional: s,
        }),
      ),
      destinos: z.array(destino),
    }),
  ),
});
export type TransplantePacienteTela = z.infer<typeof esquemaTransplantePaciente>;
export type DoacaoTela = TransplantePacienteTela['doacoes'][number];
export type InscricaoTela = TransplantePacienteTela['inscricoes'][number];

export const esquemaReceptoresLista = z.array(
  z.object({
    id: z.number(),
    paciente: z.number(),
    prontuario: s,
    cadastradoEm: s,
    situacao: z.string(),
    apto: z.boolean(),
    urgencia: z.boolean(),
    numeroRegistroCentral: s,
  }),
);
export type ReceptorListaTela = z.infer<typeof esquemaReceptoresLista>[number];

export async function lerOpcoesTransplante(buscar: typeof fetch = fetch): Promise<OpcoesTransplanteTela> {
  const r = await buscar(`${P}/opcoes`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaOpcoesTransplante.parse(await r.json());
}

export async function lerTransplantePaciente(
  paciente: number,
  buscar: typeof fetch = fetch,
): Promise<TransplantePacienteTela> {
  const r = await buscar(`${P}/paciente/${paciente}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaTransplantePaciente.parse(await r.json());
}

export async function lerReceptoresDoOrgao(
  orgao: number,
  doador: number,
  buscar: typeof fetch = fetch,
): Promise<ReceptorListaTela[]> {
  const r = await buscar(`${P}/receptores?orgao=${orgao}&doador=${doador}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaReceptoresLista.parse(await r.json());
}

export type GravacaoTransplanteTela =
  'doador' | 'antibiotico' | 'preservacao' | 'receptor' | 'destino' | 'acompanhamento';

export async function gravarTransplante(
  tipo: GravacaoTransplanteTela,
  corpo: Record<string, unknown>,
  buscar: typeof fetch = fetch,
) {
  const r = await buscar(`${P}/${tipo}`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave(`pep.transplante.${tipo}`),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z
    .object({ ok: z.boolean(), mensagem: z.string().optional() })
    .passthrough()
    .parse(await r.json());
}
