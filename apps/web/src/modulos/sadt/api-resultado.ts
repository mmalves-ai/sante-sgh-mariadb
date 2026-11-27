// Digitação, liberação e retificação do resultado pelo exame pedido (F3.5, 05-SADT linha 10): as rotas do banco do
// cliente (`/api/sadt/exames-pedidos/:exame/resultado`), com o analito pelo id e sem versão por carimbo de data. O
// servidor decide tudo (faixa congelada, crítico, habilitação de quem libera, versão guardada na retificação) e, na
// mesma gravação, abre o aviso do valor crítico e avisa da retificação quem já tinha visto. No ambiente de
// demonstração em memória (sem banco do cliente, o servidor responde 503 "indisponivel") a gravação segue pelo
// executor em memória, com a mesma entrada da tela.
import { z } from 'zod';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { codigoDaRecusa, enviar } from '../exames/api-exames.js';
import { liberarResultado, registrarResultado, retificarResultado } from './api-sadt.js';

const esquemaResultadoGravado = z.object({
  resultado: z.number(),
  exame: z.number(),
  situacao: z.string(),
  numeroVersao: z.number(),
  critico: z.boolean(),
  anormal: z.boolean(),
});
export type ResultadoGravado = z.infer<typeof esquemaResultadoGravado>;

/** O que a tela mostra depois de gravar: o resultado do banco, ou a mensagem pronta do ambiente em memória. */
export interface GravacaoResultado {
  readonly gravado: ResultadoGravado | null;
  readonly mensagem: string | null;
}

export interface ValorDaTela {
  readonly elemento: number;
  readonly numerico: number | null;
  readonly alfa: string | null;
}

const rota = (exame: number, acao = '') => `/api/sadt/exames-pedidos/${exame}/resultado${acao}`;

/** Os valores da tela no contrato do banco: o analito pelo id, número ou texto. */
export const valoresDoBanco = (
  elementos: readonly ValorDaTela[],
): { analito: number; numero: number | null; texto: string | null }[] =>
  elementos.map((e) => ({
    analito: e.elemento,
    numero: e.numerico,
    texto: e.numerico === null ? e.alfa : null,
  }));

/** 503 com o código próprio "sem-banco-cliente" (sadt/sem-banco-cliente.ts no servidor): a rota do banco do cliente
 * não existe neste ambiente. O 503 de outra causa não cai na fonte em memória. */
const semBanco = (e: unknown): boolean =>
  e instanceof ErroApi && e.status === 503 && codigoDaRecusa(e) === 'sem-banco-cliente';

async function gravar(
  url: string,
  corpo: unknown,
  chave: string,
  emMemoria: () => Promise<{ mensagem: string }>,
): Promise<GravacaoResultado> {
  try {
    return { gravado: await enviar(url, corpo, esquemaResultadoGravado, chave), mensagem: null };
  } catch (e) {
    if (!semBanco(e)) throw e;
    return { gravado: null, mensagem: (await emMemoria()).mensagem };
  }
}

export function digitarResultado(
  exame: { id: number; versao: string | null },
  e: {
    elementos: readonly ValorDaTela[];
    observacao: string;
    variaveis: readonly { codigo: number; valor: number }[];
    /** Condições da amostra apontadas pela bancada (avaliadas pela autoliberação). */
    interferentesAmostra?: readonly number[];
  },
  chave: string,
): Promise<GravacaoResultado> {
  return gravar(
    rota(exame.id),
    {
      valores: valoresDoBanco(e.elementos),
      ...(e.observacao ? { observacao: e.observacao } : {}),
      ...(e.interferentesAmostra?.length ? { interferentesAmostra: e.interferentesAmostra } : {}),
      ...(e.variaveis.length
        ? { variaveis: e.variaveis.map((v) => ({ variavel: v.codigo, valor: v.valor })) }
        : {}),
    },
    chave,
    () =>
      registrarResultado(
        exame.id,
        {
          versao: exame.versao,
          elementos: e.elementos.map((x) => ({ ...x, absoluta: null })),
          observacoes: e.observacao ? [e.observacao] : [],
          variaveis: e.variaveis,
        },
        chave,
      ),
  );
}

export function liberarResultadoDoExame(
  exame: { id: number; versao: string | null },
  confirmarCritico: boolean,
  chave: string,
): Promise<GravacaoResultado> {
  return gravar(rota(exame.id, '/liberar'), {}, chave, () =>
    liberarResultado(exame.id, { versao: exame.versao, confirmarCritico }, chave),
  );
}

export function retificarResultadoDoExame(
  exame: { id: number; versao: string | null },
  e: { elementos: readonly ValorDaTela[]; motivo: string },
  chave: string,
): Promise<GravacaoResultado> {
  return gravar(
    rota(exame.id, '/retificar'),
    { valores: valoresDoBanco(e.elementos), motivo: e.motivo.trim() },
    chave,
    () =>
      retificarResultado(
        exame.id,
        {
          versao: exame.versao,
          motivo: e.motivo,
          elementos: e.elementos.map((x) => ({ ...x, absoluta: null })),
        },
        chave,
      ),
  );
}
