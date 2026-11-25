// Cadastro das restrições próprias do hospital no apoio à decisão da prescrição (03-PEP L108): ajuste de dose por faixa
// de função renal, hepática ou diálise, restrição de posologia por paciente e setor e configuração do alerta no setor.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const B = '/api/pep/prescricao/restricoes';
const opcao = z.object({ id: z.number(), nome: z.string() });
const n = z.number().nullable();
const alvo = { item: n, principio: n, alvoNome: z.string() };
const esquema = z.object({
  ajustes: z.array(
    z
      .object({
        id: z.number(),
        versao: z.number(),
        ...alvo,
        criterio: z.string(),
        faixaMinima: n,
        faixaMaxima: n,
        classeHepatica: z.string().nullable(),
        modalidadeDialise: z.string().nullable(),
        ajuste: z.string(),
        percentualDose: n,
        doseMaxima: n,
        unidade: n,
        intervaloHoras: n,
        comportamento: z.string(),
        orientacao: z.string().nullable(),
        ativo: z.boolean(),
      })
      .passthrough(),
  ),
  restricoes: z.array(
    z
      .object({
        id: z.number(),
        versao: z.number(),
        ...alvo,
        setor: n,
        tipo: z.string(),
        acao: z.string(),
        mensagem: z.string(),
        ativo: z.boolean(),
      })
      .passthrough(),
  ),
  configuracoes: z.array(
    z
      .object({
        id: z.number(),
        versao: z.number(),
        regra: z.number(),
        regraCodigo: z.string(),
        tipo: z.string(),
        setor: n,
        comportamento: z.string(),
        vigenciaInicio: z.string().nullable(),
        vigenciaFim: z.string().nullable(),
        ativo: z.boolean(),
      })
      .passthrough(),
  ),
  apoio: z.object({
    regras: z.array(opcao),
    setores: z.array(opcao),
    vias: z.array(opcao),
    sexos: z.array(opcao),
    unidades: z.array(opcao),
  }),
});
export type CadastroRestricoes = z.infer<typeof esquema>;
const gravado = z.object({ id: z.number(), versao: z.number() });

export async function lerRestricoes(buscar: typeof fetch = fetch): Promise<CadastroRestricoes> {
  const r = await buscar(B, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

export async function gravarRestricaoPrescricao(
  tipo: 'ajustes-renais' | 'posologia' | 'configuracoes',
  corpo: Record<string, unknown>,
  buscar: typeof fetch = fetch,
): Promise<{ id: number; versao: number }> {
  const r = await buscar(`${B}/${tipo}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave(`restricoes-${tipo}`),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return gravado.parse(await r.json());
}
