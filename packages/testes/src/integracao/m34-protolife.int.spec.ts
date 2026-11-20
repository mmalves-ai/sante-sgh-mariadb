// M34 (D-PROTOLIFE-34; correção da revisão): a prova de que o banco recusa gravar nos perfis de prioridade da
// classificação de risco externa (RETPPROTOLIFE): por isso o cadastro fica só em consulta, sem receita de gravação nem
// assinatura. Na transação SEMPRE desfeita, sob a trava da cópia; a saída é a contagem e a mensagem do banco.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alterarPerfilDaClassificacaoExterna,
  incluirPerfilDaClassificacaoExterna,
  perfisDaClassificacaoExterna,
} from '../massa/simulacao-legado-m34.js';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const mensagem = (e: unknown) => (e instanceof Error ? `${e.message} ${String(e.cause ?? '')}` : String(e));

describe.skipIf(!PODE_ESCREVER)('classificação de risco externa na cópia (D-PROTOLIFE-34)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('o gatilho do fornecedor recusa a alteração e a inclusão (ROLLBACK; a contagem fica igual)', async () => {
    const antes = await a.nucleo.lerSomente(ctx(a), (l) => perfisDaClassificacaoExterna(l));
    const recusas: string[] = [];
    for (const gravar of [alterarPerfilDaClassificacaoExterna, incluirPerfilDaClassificacaoExterna]) {
      const r = await a.nucleo
        .desfazendoNaCopia(ctx(a), (e) => gravar(e))
        .then(
          () => 'gravou',
          (e: unknown) => mensagem(e),
        );
      recusas.push(r);
    }
    console.log(`[${a.cod}] RETPPROTOLIFE: ${antes} perfis; recusas: ${JSON.stringify(recusas)}`);
    for (const r of recusas) expect(r).toMatch(/E_GERAL_SISTEMA[\s\S]*TRG_RETPPROTOLIFE_BIUD/);
    expect(await a.nucleo.lerSomente(ctx(a), (l) => perfisDaClassificacaoExterna(l))).toBe(antes);
  });
});
