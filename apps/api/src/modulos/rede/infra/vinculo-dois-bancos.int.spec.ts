// Integração do MPI da Rede nas DUAS cópias (M57, etapa 1; regra 4; ficha, seção 10: "vínculo nos dois bancos, queda
// no meio, relatório de divergência"), sempre em transações DESFEITAS, uma por banco (nenhuma cruza os bancos):
//   - o ciclo de pareamento num lote real (cada cadastro do lote se encontra no outro banco, que é a mesma cópia);
//   - "é a mesma pessoa" grava a pessoa, o vínculo e o candidato nos DOIS bancos, com a mesma chave e a mesma pessoa;
//   - queda entre as duas gravações (o segundo banco recusa): o primeiro fica gravado, o resultado diz `pendente`, o
//     relatório de divergência acha 1, o reparo completa e a divergência volta a 0 (repetir não grava nada);
//   - desfazer marca `desfeito` nos dois e devolve o par à fila como reaberto por uma pessoa (o automático não o
//     religa), e a busca da fila pelo prontuário o acha;
//   - em cada banco, só tabelas SGH_ escritas na transação (monitoramento): nenhuma tabela do cadastro (regra 1).
// Rodar: flock …/copia.lock flock …/copia2/copia.lock env FB_PC_PORTA=3351 SGH_INT_REDE_PORTA2=3352 ./pnpm exec vitest
//        run --config apps/api/vitest.integracao.config.ts src/modulos/rede
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cadastroAtivoDeAmostraRede, escritasDaTransacao, type Escritor } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../../problema.filter.js';
import { ServicoMpiRede, type SessaoRede } from '../aplicacao/servico.js';
import { portaRedeNasTransacoes } from '../porta-legado.js';
import type { PortaRede } from '../porta.js';
import {
  type AmbienteDuasCopias,
  ambienteDuasCopias,
  DUAS_COPIAS,
  emDuasTransacoesDesfeitas,
  SEGUNDO,
} from './duas-copias.spec-util.js';

const LOGIN = 'SGH.TESTE.M57';

function sessao(rede: string): SessaoRede {
  return {
    rede,
    hospital: 'pc',
    login: LOGIN,
    trilha: (evento, operacao, alvo) => ({
      rede,
      hospital: 'pc',
      usuario: LOGIN,
      evento,
      recurso: 'rede.mpi',
      operacao,
      tabelaAlvo: 'SGH_REDE_VINCULO',
      idAlvo: alvo.id ?? null,
      chaveNaturalAlvo: alvo.chave,
      resultado: 'sucesso',
      estacao: 'SGH-TESTE:int-m57',
      correlacao: 'int-m57',
    }),
  };
}

async function tabelasEscritas(e: Escritor): Promise<string[]> {
  return [...new Set((await escritasDaTransacao(e)).map((w) => w.tabela))].sort();
}

describe.skipIf(!DUAS_COPIAS)('MPI da Rede nas duas cópias (transações desfeitas)', () => {
  let a: AmbienteDuasCopias;
  beforeAll(async () => {
    a = await ambienteDuasCopias();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('ciclo, vínculo nos dois bancos, queda no meio → divergência → reparo → 0, desfazer; só SGH_', async () => {
    const r = await emDuasTransacoesDesfeitas(a, async (tx) => {
      const s = sessao(a.rede);
      let pessoa = 0;
      const falhar = new Set<string>();
      const base = portaRedeNasTransacoes(a.rede, tx);
      const porta: PortaRede = {
        ...base,
        gravar: (c, fn, trilha) =>
          falhar.has(c.hospital)
            ? Promise.reject(new ErroProblema('indisponivel', 503, 'Banco indisponível (simulado)'))
            : base.gravar(c, fn, trilha),
      };
      const servico = new ServicoMpiRede(porta, {
        novaPessoa: () => `int-m57-${Date.now().toString(36)}-${++pessoa}`,
      });
      // Um cadastro ativo de ID alto (fora do lote do ciclo, que começa do ID 1).
      const x = await cadastroAtivoDeAmostraRede(tx.get('pc')!);
      if (!x) throw new Error('A cópia não tem cadastro ativo.');
      const { id, prontuario: pront } = x;
      const chave = `pc:${id}|${SEGUNDO}:${id}`;

      // 1. O ciclo de pareamento num lote real (só agregados saem).
      const t0 = Date.now();
      const ciclo = await servico.ciclo(s, 50);
      const msCiclo = Date.now() - t0;
      const divergenciasDoCiclo = (await servico.divergencias(s)).total;

      // 2. O par aberto nos dois bancos (como o ciclo deixaria) e "é a mesma pessoa".
      for (const [est, outro] of [
        ['pc', SEGUNDO],
        [SEGUNDO, 'pc'],
      ] as const)
        await porta.gravar(
          { rede: a.rede, hospital: est },
          (g) =>
            g.candidatos([
              {
                chave,
                idLocal: id,
                prontuarioLocal: pront,
                estabelecimentoRemoto: outro,
                idRemoto: id,
                prontuarioRemoto: pront,
                pontuacao: 65,
                criterios: ['nome', 'mae', 'nascimento', 'sexo'],
                divergencias: [],
                situacao: 'aberto',
                por: LOGIN,
                em: new Date().toISOString(),
              },
            ]),
          null,
        );
      // 3. Queda entre as duas gravações: o segundo banco recusa.
      falhar.add(SEGUNDO);
      const vinculo = await servico.decidir(s, chave, { decisao: 'mesma_pessoa' });
      falhar.clear();
      const divergenciasDaQueda = await servico.divergencias(s);
      const reparo = await servico.reparar(s);
      const reparoDeNovo = await servico.reparar(s);
      const divergenciasDepois = (await servico.divergencias(s)).total;
      const vinculos = await Promise.all(
        ['pc', SEGUNDO].map((est) => porta.vinculo({ rede: a.rede, hospital: est }, chave)),
      );
      // 4. Desfazer nos dois, devolvendo à fila.
      const desfeito = await servico.desfazer(s, chave, {
        justificativa: 'Integração sintética do M57',
        reabrir: true,
      });
      const candidatos = await Promise.all(
        ['pc', SEGUNDO].map((est) => porta.candidato({ rede: a.rede, hospital: est }, chave)),
      );
      const depoisDeDesfazer = await Promise.all(
        ['pc', SEGUNDO].map((est) => porta.vinculo({ rede: a.rede, hospital: est }, chave)),
      );
      // 5. Reaberto por uma pessoa: o pareamento o vê como `reaberto` (o automático não o religa), e a busca da fila
      // pelo prontuário acha o par.
      const reabertos = await Promise.all(
        ['pc', SEGUNDO].map(async (est) =>
          (await porta.situacoes({ rede: a.rede, hospital: est }, [chave])).get(chave),
        ),
      );
      const busca = await servico.fila(s, {
        situacao: 'aberto',
        prontuario: pront,
        pagina: 1,
        porPagina: 20,
      });
      const divergenciasFinais = (await servico.divergencias(s)).total;
      return {
        ciclo,
        msCiclo,
        divergenciasDoCiclo,
        vinculo,
        divergenciasDaQueda,
        reparo,
        reparoDeNovo,
        divergenciasDepois,
        vinculos,
        desfeito,
        candidatos,
        depoisDeDesfazer,
        reabertos,
        busca: busca.itens.map((i) => i.chave),
        divergenciasFinais,
        escritas: { pc: await tabelasEscritas(tx.get('pc')!), sx: await tabelasEscritas(tx.get(SEGUNDO)!) },
      };
    });

    // Só agregados (sem dado de pessoa), no log e em .tmp/ para as evidências (contagens de 1 a 4 viram "<5").
    const seguro = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));
    const pasta = resolve(import.meta.dirname, '../../../../../../.tmp');
    mkdirSync(pasta, { recursive: true });
    writeFileSync(
      resolve(pasta, 'int-m57-ciclo.json'),
      `${JSON.stringify(
        {
          lote: 50,
          lidos: seguro(r.ciclo.lidos),
          automaticos: seguro(r.ciclo.automaticos),
          naFila: seguro(r.ciclo.naFila),
          descartados: seguro(r.ciclo.descartados),
          duplicadosLocais: seguro(r.ciclo.duplicadosLocais),
          inelegiveis: seguro(r.ciclo.inelegiveis),
          ms: r.msCiclo,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      // Só os agregados já higienizados (abaixo de 5 vira <5), como no JSON.
      `[int-m57] ciclo de 50 por banco: lidos ${seguro(r.ciclo.lidos)}, automáticos ${seguro(r.ciclo.automaticos)}, na fila ${seguro(r.ciclo.naFila)}, descartados ${seguro(r.ciclo.descartados)}, duplicados locais ${seguro(r.ciclo.duplicadosLocais)}, inelegíveis ${seguro(r.ciclo.inelegiveis)}, ${r.msCiclo} ms`,
    );
    expect(r.ciclo.lidos).toBeGreaterThan(0);
    expect(r.ciclo.automaticos).toBeGreaterThan(0);
    expect(r.divergenciasDoCiclo).toBe(0);
    expect(r.vinculo.bancos).toEqual([
      { estabelecimento: 'pc', situacao: 'gravado' },
      { estabelecimento: 'sx', situacao: 'pendente' },
    ]);
    expect(r.divergenciasDaQueda.total).toBe(1);
    expect(r.divergenciasDaQueda.itens[0]).toMatchObject({ tipo: 'ausente_em_um_banco' });
    expect(r.reparo).toEqual({ reparados: 1, pendentes: 0, manuais: [] });
    expect(r.reparoDeNovo).toEqual({ reparados: 0, pendentes: 0, manuais: [] });
    expect(r.divergenciasDepois).toBe(0);
    expect(r.vinculos[0]?.pessoa).toBe(r.vinculo.pessoa);
    expect(r.vinculos[1]?.pessoa).toBe(r.vinculo.pessoa);
    expect(r.vinculos.map((v) => v?.situacao)).toEqual(['ativo', 'ativo']);
    expect(r.desfeito.bancos.map((b) => b.situacao)).toEqual(['gravado', 'gravado']);
    expect(r.candidatos.map((c) => c?.situacao)).toEqual(['aberto', 'aberto']);
    expect(r.depoisDeDesfazer.map((v) => v?.situacao)).toEqual(['desfeito', 'desfeito']);
    expect(r.candidatos.map((c) => c?.origem)).toEqual(['humano', 'humano']);
    expect(r.reabertos).toEqual(['reaberto', 'reaberto']);
    expect(r.busca).toContain(r.vinculo.chave);
    expect(r.divergenciasFinais).toBe(0);
    // Regra 1: em cada banco, só as tabelas do índice da Rede, a fila do cadastro (regra 5) e a trilha.
    for (const t of [...r.escritas.pc, ...r.escritas.sx]) expect(t).toMatch(/^SGH_/);
    for (const t of [...r.escritas.pc, ...r.escritas.sx])
      expect([
        'SGH_REDE_PESSOA',
        'SGH_REDE_VINCULO',
        'SGH_REDE_CANDIDATO',
        'SGH_REDE_MARCA',
        'SGH_CAD_DUPLICIDADE',
        'SGH_TRILHA',
      ]).toContain(t);
    expect(r.escritas.pc).toContain('SGH_REDE_VINCULO');
    expect(r.escritas.sx).toContain('SGH_REDE_VINCULO');
  }, 900_000);
});
