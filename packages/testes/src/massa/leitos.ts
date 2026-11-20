// Massa SINTÉTICA do M16: a "gravação por fora" do vigia — uma transferência da internação em aberto, gravada como o
// outro sistema gravaria (RITRANSF não tem gatilho nem gerador), SEMPRE dentro de uma transação desfeita do teste
// (desfazendoNaCopia). Marcada na justificativa; nenhum dado de pessoa.
import type { Escritor } from '@sgh/legado';
import { MARCA_SINTETICA } from './sintetica.js';

export interface InternacaoAbertaDoTeste {
  readonly reg: number;
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
}

/** A internação em aberto mais nova (só números e a posição do leito). */
export async function internacaoAbertaParaOTeste(
  e: Pick<Escritor, 'consultar'>,
): Promise<InternacaoAbertaDoTeste | null> {
  const [x] = await e.consultar(
    "SELECT FIRST 1 REG, BLOCO, ACOMOD, LEITO FROM RICADINT WHERE ALTA = DATE '1899-12-30' ORDER BY REG DESC",
    [],
    { teto: 1 },
  );
  if (!x) return null;
  const t = (v: unknown) => String(v ?? '');
  return { reg: Number(x['REG']), bloco: t(x['BLOCO']), acomodacao: t(x['ACOMOD']), leito: t(x['LEITO']) };
}

/** Quantas transferências há (a contagem que o ROLLBACK tem de devolver igual). */
export async function contarTransferencias(e: Pick<Escritor, 'consultar'>): Promise<number> {
  const [n] = await e.consultar('SELECT COUNT(*) N FROM RITRANSF', [], { teto: 1 });
  return Number(n?.['N'] ?? NaN);
}

/** A transferência sintética (no mesmo leito, às 23:59 de hoje), na transação desfeita do chamador. */
export async function gravarTransferenciaPorFora(e: Escritor, i: InternacaoAbertaDoTeste): Promise<void> {
  await e.executar(
    `INSERT INTO RITRANSF (REG, DATA, HORA, BLOCOO, ACOMODO, LEITOO, BLOCOD, ACOMODD, LEITOD, JUSTIF)
     VALUES (?, CURRENT_DATE, '2359', ?, ?, ?, ?, ?, ?, ?)`,
    [i.reg, i.bloco, i.acomodacao, i.leito, i.bloco, i.acomodacao, i.leito, MARCA_SINTETICA.slice(0, 30)],
  );
}
