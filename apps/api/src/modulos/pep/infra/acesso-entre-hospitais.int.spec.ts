// Integração do aviso e do acesso cruzado entre os estabelecimentos da rede nas DUAS cópias (M57, etapa 2; ficha,
// seção 4 e regras 6 e 7), sempre em transações DESFEITAS, uma por banco (nenhuma cruza os bancos). A cópia 3351 é o
// `pc` e a 3352, o estabelecimento sintético `sx` (D-COPIAS-57: o cadastro X de um é a mesma pessoa do X do outro):
//   - o aviso "tem atendimentos em outro estabelecimento" lê o vínculo no banco da sessão e, no outro, só a contagem e as
//     datas (RECADATE e RICADINT pelo prontuário): igual à contagem direta, p95 < 500 ms;
//   - regra 6: com a regra da DP-42 desligada no outro estabelecimento, o acesso cruzado é recusado ANTES de qualquer
//     leitura do prontuário e de qualquer trilha (nada escrito lá); sem vínculo ativo, 404; depois de desfeito, 404;
//   - regra 7: com a regra ligada, a leitura vai à trilha DO BANCO ONDE O REGISTRO ESTÁ (o `sx`) pela operação de
//     auditoria do M15 (Consulta do RES, opção 5146: SGH_TRILHA e TBCABTRILHA/TBLANTRILHASGH lá), antes da linha do
//     tempo; no `pc`, só as tabelas do índice e a SGH_TRILHA do vínculo (nenhuma tabela do cadastro).
// Nenhum dado de pessoa sai daqui: o login de um usuário com papel e o cadastro de amostra ficam só em memória; o log e
// as evidências levam contagens e tempos.
// Rodar: flock …/copia.lock flock …/copia2/copia.lock env FB_PC_PORTA=3351 SGH_INT_REDE_PORTA2=3352 ./pnpm exec vitest
//        run --config apps/api/vitest.integracao.config.ts src/modulos/pep/infra
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cadastroAtivoDeAmostraRede,
  contarAtendimentosRede,
  type Escritor,
  escritasDaTransacao,
  Executor,
  gravarTrilha,
  somenteSgh,
  usuarioComPapelDeAmostraRede,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaLegado } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { ServicoMpiRede, type SessaoRede } from '../../rede/aplicacao/servico.js';
import {
  type AmbienteDuasCopias,
  ambienteDuasCopias,
  DUAS_COPIAS,
  SEGUNDO,
} from '../../rede/infra/duas-copias.spec-util.js';
import { portaRedeNasTransacoes } from '../../rede/porta-legado.js';
import { AcessoProntuarioRede } from '../acesso-rede.js';
import { portaDocumentosLegado } from '../documentos-porta-legado.js';
import { ServicoDocumentos } from '../documentos-servico.js';

const PEDIDO = { motivo: 'assistencia' as const, justificativa: 'Integração sintética do M57.2', pagina: 1 };

async function tabelasEscritas(e: Escritor): Promise<string[]> {
  return [...new Set((await escritasDaTransacao(e)).map((w) => w.tabela))].sort();
}

function p95(ms: readonly number[]): number {
  const o = [...ms].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil(o.length * 0.95) - 1)] ?? 0;
}

describe.skipIf(!DUAS_COPIAS)('aviso e acesso cruzado nas duas cópias (transações desfeitas)', () => {
  let a: AmbienteDuasCopias;
  beforeAll(async () => {
    a = await ambienteDuasCopias();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('aviso só com contagens (p95 < 500 ms); regra 6 recusa antes de ler; regra 7 grava a trilha no banco do registro', async () => {
    const r = await a.nucleo.desfazendoNaCopia(
      { rede: a.rede, hospital: 'pc', traceId: 'int-m57-2-pc' },
      (e1) =>
        a.nucleo.desfazendoNaCopia(
          { rede: a.rede, hospital: SEGUNDO, traceId: 'int-m57-2-sx' },
          async (e2) => {
            const brutos = new Map<string, Escritor>([
              ['pc', e1],
              [SEGUNDO, e2],
            ]);
            const porta = portaRedeNasTransacoes(
              a.rede,
              new Map([
                ['pc', somenteSgh(e1)],
                [SEGUNDO, somenteSgh(e2)],
              ]),
            );
            // Correção do M57.2: com CPF no cadastro de usuários (a prova de que é a mesma pessoa nos dois bancos).
            const login = await usuarioComPapelDeAmostraRede(e1, { comCpf: true });
            if (!login) throw new Error('A cópia não tem usuário com papel ativo e CPF.');
            const s: SessaoRede = {
              rede: a.rede,
              hospital: 'pc',
              login,
              trilha: (evento, operacao, alvo) => ({
                rede: a.rede,
                hospital: 'pc',
                usuario: login,
                evento,
                recurso: 'rede.mpi',
                operacao,
                tabelaAlvo: 'SGH_REDE_VINCULO',
                idAlvo: alvo.id ?? null,
                chaveNaturalAlvo: alvo.chave,
                resultado: 'sucesso',
                estacao: 'SGH-TESTE:int-m57-2',
                correlacao: 'int-m57-2',
              }),
            };
            let n = 0;
            const servico = new ServicoMpiRede(porta, {
              novaPessoa: () => `int-m57-2-${Date.now().toString(36)}-${++n}`,
            });
            const x = await cadastroAtivoDeAmostraRede(e1);
            if (!x) throw new Error('A cópia não tem cadastro ativo.');
            const chave = `pc:${x.id}|${SEGUNDO}:${x.id}`;

            // 0. Sem vínculo: o aviso não lê o outro banco.
            const semVinculo = await servico.avisoDoPaciente(s, x.id, async () => ({
              pode: false,
              motivo: null,
            }));

            // 1. O par "é a mesma pessoa" nos dois bancos (como a fila da etapa 1 deixa).
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
                      idLocal: x.id,
                      prontuarioLocal: x.prontuario,
                      estabelecimentoRemoto: outro,
                      idRemoto: x.id,
                      prontuarioRemoto: x.prontuario,
                      pontuacao: 90,
                      criterios: ['cpf', 'nome', 'nascimento'],
                      divergencias: [],
                      situacao: 'aberto',
                      por: login,
                      em: new Date().toISOString(),
                    },
                  ]),
                null,
              );
            await servico.decidir(s, chave, { decisao: 'mesma_pessoa' });

            // 2. O aviso (20 leituras; a primeira aquece) e a contagem direta no outro banco.
            const tempos: number[] = [];
            let aviso = await servico.avisoDoPaciente(s, x.id, async () => ({
              pode: false,
              motivo: 'DP-42',
            }));
            for (let i = 0; i < 20; i++) {
              const t0 = performance.now();
              aviso = await servico.avisoDoPaciente(s, x.id, async () => ({ pode: false, motivo: 'DP-42' }));
              tempos.push(performance.now() - t0);
            }
            const direta = await contarAtendimentosRede(e2, x.prontuario);

            // 3. O acesso cruzado: a trilha do outro banco pela operação de auditoria do M15, na transação desfeita dele.
            const executor = new Executor({
              ambiente: 'dev',
              catalogo: { estado: () => 'verde' },
              schema: { bloqueada: () => false },
              ler: () => Promise.reject(new Error('não usado (escritor de quem chama)')),
              escrever: () => Promise.reject(new Error('não usado (escritor de quem chama)')),
            });
            // As estatísticas de MON$ são um retrato fixo por transação (o primeiro acesso): as escritas só são lidas no fim;
            // até lá, quem conta os registros na trilha é este invólucro.
            const registros: string[] = [];
            const proprias: { hospital: string; usuario: string }[] = [];
            const trilha = new RegistradorTrilhaLegado(
              {
                registrarTrilhaPropria: async (ctx, linha) => {
                  proprias.push({ hospital: ctx.hospital, usuario: linha.usuario });
                  return { id: (await gravarTrilha(brutos.get(ctx.hospital)!, linha)).id };
                },
              },
              {
                executar: (op, hospital, entrada, ctx) => {
                  registros.push(hospital);
                  return executor.executar(op, hospital, entrada, ctx, { escritor: brutos.get(hospital)! });
                },
              },
            );
            let linhasLidas = 0;
            const documentos = new ServicoDocumentos(
              portaDocumentosLegado(a.nucleo, { estado: () => 'verde' }),
            );
            const ligada = { valor: false };
            const acessoDocs = {
              exigirPaciente: (c: Parameters<ServicoDocumentos['exigirPaciente']>[0], p: number) =>
                documentos.exigirPaciente(c, p),
              linhaTempo: async (...args: Parameters<ServicoDocumentos['linhaTempo']>) => {
                linhasLidas++;
                return documentos.linhaTempo(...args);
              },
            };
            const acesso = new AcessoProntuarioRede({
              rede: porta,
              documentos: acessoDocs,
              trilha,
              ligadaNoEstabelecimento: async () => ligada.valor,
            });
            const sa = {
              rede: a.rede,
              hospital: 'pc',
              login,
              estacao: 'SGH-TESTE:int-m57-2',
              correlacao: 'int-m57-2',
            };
            let recusa: string | null = null;
            await acesso.abrir(sa, x.id, SEGUNDO, PEDIDO, null).catch((err: unknown) => {
              recusa = err instanceof ErroProblema ? String(err.extras?.['codigo'] ?? err.tipo) : String(err);
            });
            const registrosNaRecusa = registros.length;
            const lidasNaRecusa = linhasLidas;
            ligada.valor = true;
            const t0 = performance.now();
            const aberto = await acesso.abrir(sa, x.id, SEGUNDO, PEDIDO, null);
            const msAbrir = performance.now() - t0;
            const registrosAoAbrir = registros.slice(registrosNaRecusa);
            // Outro estabelecimento que não é da rede e o mesmo da sessão: recusados.
            const foraDaRede = await acesso
              .abrir(sa, x.id, 'zz', PEDIDO, null)
              .then(() => null)
              .catch((err: unknown) =>
                err instanceof ErroProblema ? String(err.extras?.['codigo']) : 'outro',
              );
            const mesmo = await acesso
              .abrir(sa, x.id, 'pc', PEDIDO, null)
              .then(() => null)
              .catch((err: unknown) =>
                err instanceof ErroProblema ? String(err.extras?.['codigo']) : 'outro',
              );

            // 3b. D-TRILHA-REMOTA-57: o mesmo login como OUTRA pessoa no outro banco (CPF diferente lá, simulado na
            // leitura): a leitura abre, mas nada vai ao executor de lá (a trilha do outro sistema); só a SGH_TRILHA lá.
            const outraPessoa = new AcessoProntuarioRede({
              rede: {
                ...porta,
                cpfDoLogin: async (c, l) => (c.hospital === SEGUNDO ? '99999999999' : porta.cpfDoLogin(c, l)),
              },
              documentos: { exigirPaciente: acessoDocs.exigirPaciente, linhaTempo: acessoDocs.linhaTempo },
              trilha,
              ligadaNoEstabelecimento: async () => true,
            });
            const registrosAntesOutra = registros.length;
            const propriasAntesOutra = proprias.length;
            await outraPessoa.abrir(sa, x.id, SEGUNDO, PEDIDO, null);
            const registrosOutraPessoa = registros.length - registrosAntesOutra;
            const trilhaSxOutraPessoa = proprias.slice(propriasAntesOutra);

            // 4. Desfeito o vínculo: o aviso some e o acesso cruzado não acha o cadastro de lá.
            await servico.desfazer(s, chave, {
              justificativa: 'Integração sintética do M57.2',
              reabrir: false,
            });
            const avisoDepois = await servico.avisoDoPaciente(s, x.id, async () => ({
              pode: true,
              motivo: null,
            }));
            const semVinculoDepois = await acesso
              .abrir(sa, x.id, SEGUNDO, PEDIDO, null)
              .then(() => null)
              .catch((err: unknown) =>
                err instanceof ErroProblema ? String(err.extras?.['codigo']) : 'outro',
              );
            return {
              semVinculo,
              aviso,
              direta,
              tempos,
              recusa,
              registrosNaRecusa,
              registrosAoAbrir,
              registrosOutraPessoa,
              trilhaSxOutraPessoa,
              lidasNaRecusa,
              aberto: {
                eventos: aberto.eventos.length,
                idRemoto: aberto.idRemoto,
                est: aberto.estabelecimento,
              },
              msAbrir,
              escritasSx: await escritasDaTransacao(e2),
              foraDaRede,
              mesmo,
              avisoDepois,
              semVinculoDepois,
              idAmostra: x.id,
              escritasPc: await tabelasEscritas(e1),
            };
          },
        ),
    );

    const ms = p95(r.tempos);
    const seguro = (v: number) => (v > 0 && v < 5 ? '<5' : String(v));
    const trilhaSx = r.escritasSx
      .filter((w) => /TRILHA/.test(w.tabela))
      .map((w) => w.tabela)
      .sort();
    const pasta = resolve(import.meta.dirname, '../../../../../../.tmp');
    mkdirSync(pasta, { recursive: true });
    writeFileSync(
      resolve(pasta, 'int-m57-2-aviso.json'),
      `${JSON.stringify(
        {
          avisoP95Ms: Math.round(ms),
          avisoMaxMs: Math.round(Math.max(...r.tempos)),
          abrirMs: Math.round(r.msAbrir),
          atendimentos: seguro(r.direta.atendimentos),
          internacoes: seguro(r.direta.internacoes),
          eventosLinhaDoTempo: seguro(r.aberto.eventos),
          trilhaNoBancoDoRegistro: trilhaSx,
          escritasPc: r.escritasPc,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `[int-m57-2] aviso p95 ${Math.round(ms)} ms; abrir ${Math.round(r.msAbrir)} ms; trilha no banco do registro: ${trilhaSx.join(', ')}`,
    );

    expect(r.semVinculo.situacao).toBe('sem-vinculo');
    expect(r.aviso.estabelecimentos).toHaveLength(1);
    expect(r.aviso.estabelecimentos[0]).toMatchObject({
      estabelecimento: SEGUNDO,
      idRemoto: r.idAmostra,
      disponivel: true,
      atendimentos: r.direta.atendimentos,
      internacoes: r.direta.internacoes,
      ultimoAtendimento: r.direta.ultimoAtendimento,
      ultimaInternacao: r.direta.ultimaInternacao,
      podeAbrir: false,
    });
    expect(r.aviso.situacao).toBe(
      r.direta.atendimentos + r.direta.internacoes > 0 ? 'com-atendimentos' : 'sem-atendimentos',
    );
    expect(ms).toBeLessThan(500);
    // Regra 6: desligada lá → recusa antes de ler o prontuário e de gravar a trilha lá.
    expect(r.recusa).toBe('recurso-desligado');
    expect(r.lidasNaRecusa).toBe(0);
    expect(r.registrosNaRecusa).toBe(0);
    expect(r.foraDaRede).toBe('fora-da-rede');
    expect(r.mesmo).toBe('fora-da-rede');
    // Regra 7: a leitura na trilha do banco onde o registro está (dupla: a própria e a do outro sistema).
    expect(r.aberto).toMatchObject({ idRemoto: r.idAmostra, est: SEGUNDO });
    expect(r.registrosAoAbrir).toEqual([SEGUNDO]);
    expect(trilhaSx).toEqual(expect.arrayContaining(['SGH_TRILHA', 'TBCABTRILHA']));
    // D-TRILHA-REMOTA-57: outra pessoa com o mesmo login lá → nada pelo executor de lá; uma linha da SGH_TRILHA lá.
    expect(r.registrosOutraPessoa).toBe(0);
    expect(r.trilhaSxOutraPessoa).toEqual([{ hospital: SEGUNDO, usuario: '(desconhecido)' }]);
    // Nenhuma tabela do cadastro em nenhum dos bancos (regra 1).
    for (const t of [...r.escritasPc, ...r.escritasSx.map((w) => w.tabela)])
      expect(t).toMatch(/^(SGH_|TBCABTRILHA$|TBLANTRILHASGH$)/);
    expect(r.avisoDepois.situacao).toBe('sem-vinculo');
    expect(r.semVinculoDepois).toBe('sem-vinculo-rede');
  }, 900_000);
});
