// Lote da exportação contábil (M32; ficha, regra 19): os eventos do financeiro do período, pela régua escolhida, com o
// de-para para as contas do contador; o lote só é registrado se a contagem e a soma do rodapé conferirem com as linhas
// (débitos = créditos) e o que não tem de-para fica contado (o cadastro genérico corrige). O arquivo vai ao armazém
// com a impressão digital; nada sai para fora (o contador busca o arquivo).
import { createHash } from 'node:crypto';
import {
  conferirLote,
  type DePara,
  type EventoFinanceiro,
  montarLoteContabil,
} from '@sgh/dominio-financeiro';

export interface FonteLote {
  eventos(
    hospital: string,
    periodo: string,
    regua: 'competencia' | 'caixa',
  ): Promise<readonly EventoFinanceiro[]>;
  dePara(hospital: string): Promise<readonly DePara[]>;
  guardar(hospital: string, nome: string, conteudo: string): Promise<string | null>;
  registrar(
    hospital: string,
    d: {
      periodo: string;
      regua: 'competencia' | 'caixa';
      lancamentos: number;
      somaDebitos: number;
      somaCreditos: number;
      semDePara: number;
      hashArquivo: string;
      chaveObjeto: string | null;
    },
  ): Promise<{ id: number }>;
}

export class ErroLoteContabil extends Error {
  override readonly name = 'ErroLoteContabil';
}

export async function exportarLoteDoPeriodo(
  fonte: FonteLote,
  hospital: string,
  periodo: string,
  regua: 'competencia' | 'caixa',
): Promise<{ id: number; lancamentos: number; soma: number; semDePara: number; hash: string }> {
  if (!/^\d{4}-\d{2}$/.test(periodo)) throw new ErroLoteContabil('Período inválido (use AAAA-MM).');
  const lote = montarLoteContabil(
    await fonte.eventos(hospital, periodo, regua),
    await fonte.dePara(hospital),
  );
  const conferido = conferirLote(lote.conteudo);
  if (!conferido.ok || conferido.lancamentos !== lote.lancamentos || conferido.soma !== lote.somaDebitos)
    throw new ErroLoteContabil('O lote não confere (contagem ou soma do rodapé): nada foi registrado.');
  const hash = createHash('sha256').update(lote.conteudo, 'utf8').digest('hex');
  const chave = await fonte.guardar(hospital, `lote-contabil-${periodo}-${regua}.txt`, lote.conteudo);
  const r = await fonte.registrar(hospital, {
    periodo,
    regua,
    lancamentos: lote.lancamentos,
    somaDebitos: lote.somaDebitos,
    somaCreditos: lote.somaCreditos,
    semDePara: lote.semDePara.length,
    hashArquivo: hash,
    chaveObjeto: chave,
  });
  return {
    id: r.id,
    lancamentos: lote.lancamentos,
    soma: lote.somaDebitos,
    semDePara: lote.semDePara.length,
    hash,
  };
}
