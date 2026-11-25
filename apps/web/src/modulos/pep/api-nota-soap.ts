// Cliente da API da nota clínica em quatro partes codificada (03-PEP L98):
// GET  /api/pep/nota-soap/paciente/:paciente       atendimentos (com a configuração aplicável) e notas do paciente
// GET  /api/pep/nota-soap/termos?sistema=&busca=    CID-10 ou CIAP-2 pelo código ou pela descrição
// GET  /api/pep/nota-soap/correspondencia/:ciap     CID-10 correspondentes ao código da CIAP-2
// POST /api/pep/nota-soap[/alterar|/assinar|/sem-efeito]
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/nota-soap';
const JSON_ACEITO = { accept: 'application/json' };
const termo = z.object({
  id: z.number(),
  sistema: z.enum(['ciap2', 'cid10']),
  codigo: z.string(),
  descricao: z.string(),
});
export type TermoNotaTela = z.infer<typeof termo>;
const configuracao = z
  .object({
    id: z.number().nullable(),
    estabelecimentoId: z.number().nullable(),
    especialidadeId: z.number().nullable(),
    ativo: z.boolean(),
    exigeSubjetivo: z.boolean(),
    exigeObjetivo: z.boolean(),
    exigeAvaliacao: z.boolean(),
    exigePlano: z.boolean(),
    usaCiap: z.boolean(),
    exigeCidAvaliacao: z.boolean(),
  })
  .passthrough();
export const esquemaNotasPaciente = z.object({
  atendimentos: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      entradaEm: z.string().nullable(),
      situacao: z.string(),
      configuracao,
    }),
  ),
  notas: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      atendimento: z.number(),
      tipo: z.string(),
      situacao: z.enum(['rascunho', 'assinada', 'sem_efeito']),
      registradaEm: z.string().nullable(),
      assinadaEm: z.string().nullable(),
      autor: z.string().nullable(),
      podeEditar: z.boolean(),
      subjetivo: z.string().nullable(),
      objetivo: z.string().nullable(),
      avaliacao: z.string().nullable(),
      plano: z.string().nullable(),
      criticidade: z.string().nullable(),
      dataUltimaMenstruacao: z.string().nullable(),
      dataProvavelParto: z.string().nullable(),
      idadeGestacionalDias: z.number().nullable(),
      edema: z.string().nullable(),
      codigos: z.array(
        z.object({
          sequencia: z.number(),
          parte: z.enum(['subjetivo', 'objetivo', 'avaliacao', 'plano']),
          ciap: termo.nullable(),
          cid: termo.nullable(),
          nota: z.string().nullable(),
          incluirListaProblemas: z.boolean(),
          problema: z.number().nullable(),
        }),
      ),
    }),
  ),
});
export type NotasPacienteTela = z.infer<typeof esquemaNotasPaciente>;

async function ler<T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

export const lerNotasPaciente = (paciente: number, buscar: typeof fetch = fetch) =>
  ler(`${P}/paciente/${paciente}`, esquemaNotasPaciente, buscar);

export const buscarTermosNota = (sistema: 'cid10' | 'ciap2', busca: string, buscar: typeof fetch = fetch) =>
  ler(`${P}/termos?${new URLSearchParams({ sistema, busca }).toString()}`, z.array(termo), buscar);

export const lerCorrespondenciaCiap = (ciap: number, buscar: typeof fetch = fetch) =>
  ler(`${P}/correspondencia/${ciap}`, z.array(termo), buscar);

const esquemaGravada = z
  .object({
    ok: z.boolean(),
    resultado: z.object({ nota: z.number(), versao: z.number(), avisos: z.string() }).passthrough(),
  })
  .passthrough();

export async function gravarNotaSoap(
  acao: '' | 'alterar' | 'assinar' | 'sem-efeito',
  corpo: Record<string, unknown>,
  buscar: typeof fetch = fetch,
) {
  const r = await buscar(acao ? `${P}/${acao}` : P, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.notaSoap'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaGravada.parse(await r.json());
}

// ------------------------------------------------------------------ configuração (administração do PEP)
// GET  /api/pep/nota-soap/configuracoes          configurações por estabelecimento e especialidade (pep.admin.ler)
// GET  /api/pep/nota-soap/configuracoes/opcoes   estabelecimentos e especialidades ativos, para os combos
// POST /api/pep/nota-soap/configuracoes          incluir ou alterar (pep.admin.editar; com a versão na alteração)
export const esquemaConfiguracaoNota = configuracao.extend({
  id: z.number(),
  descricao: z.string(),
  versao: z.number(),
});
export type ConfiguracaoNotaTela = z.infer<typeof esquemaConfiguracaoNota>;
const opcao = z.object({ id: z.number(), nome: z.string() });
export const esquemaOpcoesConfiguracaoNota = z.object({
  estabelecimentos: z.array(opcao),
  especialidades: z.array(opcao),
});
export type OpcoesConfiguracaoNotaTela = z.infer<typeof esquemaOpcoesConfiguracaoNota>;

export const lerConfiguracoesNota = (buscar: typeof fetch = fetch) =>
  ler(`${P}/configuracoes`, z.array(esquemaConfiguracaoNota), buscar);

export const lerOpcoesConfiguracaoNota = (buscar: typeof fetch = fetch) =>
  ler(`${P}/configuracoes/opcoes`, esquemaOpcoesConfiguracaoNota, buscar);

export interface EntradaConfiguracaoNotaTela {
  id: number | null;
  versao: number | null;
  estabelecimento: number | null;
  especialidade: number | null;
  descricao: string;
  exigeSubjetivo: boolean;
  exigeObjetivo: boolean;
  exigeAvaliacao: boolean;
  exigePlano: boolean;
  usaCiap: boolean;
  exigeCidAvaliacao: boolean;
  ativo: boolean;
}

export async function gravarConfiguracaoNota(
  corpo: EntradaConfiguracaoNotaTela,
  buscar: typeof fetch = fetch,
): Promise<{ id: number; versao: number }> {
  const r = await buscar(`${P}/configuracoes`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.notaSoap.configuracao'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  const g = z
    .object({ resultado: z.object({ id: z.number(), versao: z.number() }).passthrough() })
    .passthrough()
    .parse(await r.json());
  return { id: g.resultado.id, versao: g.resultado.versao };
}
