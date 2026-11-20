// Regra 19 do M32 (cap-06b §6.8, Decisão; cap-07 §7.2): sem contabilidade própria nesta fase. A exportação ao sistema
// do contador leva o de-para (TBINTCRC: o evento do financeiro → conta contábil; TBINTIMP: o imposto; RPINTEVE: o
// evento do repasse) e um lote com CONTAGEM e SOMA conferíveis (débitos = créditos). O lançamento sem de-para não sai:
// fica na lista "sem de-para" para o cadastro (CRUD genérico).
import { centavos } from '@sgh/contratos/regras-financeiro';

export interface EventoFinanceiro {
  readonly data: string;
  /** Chave do de-para: o tipo de lançamento (MFTIPOLANC) ou o item gerencial. */
  readonly evento: string;
  readonly valor: number;
  readonly historico: string;
  readonly documento: string;
}

export interface DePara {
  readonly evento: string;
  readonly contaDebito: string;
  readonly contaCredito: string;
}

export interface LoteContabil {
  readonly linhas: readonly string[];
  readonly lancamentos: number;
  readonly somaDebitos: number;
  readonly somaCreditos: number;
  readonly semDePara: readonly EventoFinanceiro[];
  readonly conteudo: string;
}

/** O lote no leiaute texto do contador (data;conta débito;conta crédito;valor;histórico;documento), com o rodapé. */
export function montarLoteContabil(
  eventos: readonly EventoFinanceiro[],
  depara: readonly DePara[],
): LoteContabil {
  const mapa = new Map(depara.map((d) => [d.evento, d]));
  const semDePara: EventoFinanceiro[] = [];
  const linhas: string[] = [];
  let soma = 0;
  for (const e of eventos) {
    const d = mapa.get(e.evento);
    if (!d || !d.contaDebito || !d.contaCredito) {
      semDePara.push(e);
      continue;
    }
    soma = centavos(soma + e.valor);
    linhas.push(
      [
        e.data,
        d.contaDebito,
        d.contaCredito,
        e.valor.toFixed(2),
        e.historico.replace(/[;\r\n]/g, ' ').slice(0, 100),
        e.documento,
      ].join(';'),
    );
  }
  const rodape = `TOTAL;${linhas.length};${soma.toFixed(2)};${soma.toFixed(2)}`;
  return {
    linhas,
    lancamentos: linhas.length,
    somaDebitos: soma,
    somaCreditos: soma,
    semDePara,
    conteudo: `${[...linhas, rodape].join('\r\n')}\r\n`,
  };
}

/** Confere o lote recebido de volta (o contador reimporta): contagem e soma do rodapé batem com as linhas. */
export function conferirLote(conteudo: string): { ok: boolean; lancamentos: number; soma: number } {
  const ls = conteudo.split(/\r?\n/).filter(Boolean);
  const rod = ls.pop() ?? '';
  const [, n = '0', d = '0', c = '0'] = rod.split(';');
  const soma = centavos(ls.reduce((s, l) => s + Number(l.split(';')[3] ?? 0), 0));
  return {
    ok: Number(n) === ls.length && Number(d) === soma && Number(c) === soma,
    lancamentos: ls.length,
    soma,
  };
}
