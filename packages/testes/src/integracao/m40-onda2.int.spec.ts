// Integração do M40 (onda 2) na cópia, tudo em transação DESFEITA (ou só leitura) e sob a trava da cópia:
//   (1) o critério de liberação do setor na tabela da lista para ligar (SGH_CFG_COEX_LIGAR, D-REG-40): grava, regrava
//       (UPDATE, sem duplicar) e lê os itens de um setor da onda 2; o gravador recusa o teste de invasão (calculado,
//       nunca registrado à mão) antes de ir ao banco, e o banco recusa o item das operações pelo CHECK com o nome dele;
//   (2) regra 4 e campo 10 ("desligar a chave com a tela aberta → a gravação é recusada"): um executor de produção
//       (catálogo dublê `liberada`) grava a solicitação de limpeza (operação da onda 2) com a chave da unidade-piloto
//       ligada; a chave é desligada por lote com o mesmo executor no ar (a tela continuaria aberta) e a gravação
//       seguinte é recusada com `operacao-nao-liberada`; nada fica gravado;
//   (3) regra 6: as leituras do relatório de contingência do posto no schema real (a unidade com mais horários numa
//       manhã do período do dump): internados por atendimento, horários da janela, alergias, lista de problemas,
//       justificativas, amostras e higienização; o relatório monta e as linhas do documento saem; saída só com
//       contagens (abaixo de 5 vira <5), nenhum nome, leito ou prontuário;
//   (4) campo 4: as três leituras do acompanhamento (checagem, higienização e registros por sistema) numa semana do
//       período do dump, SOMENTE LEITURA, com os indicadores do domínio; só agregados.
// Massa sintética nas gravações (operador e leito livre); as leituras do relatório não imprimem nada de paciente.
import {
  indicadorChecagem,
  indicadorHigienizacao,
  planejarLote,
  registrosPorSistema,
} from '@sgh/dominio-config';
import { camposDoRelatorioContingencia, montarRelatorioContingencia } from '@sgh/dominio-enfermagem';
import {
  aplicarLoteLiberacao,
  contarUsoDoDia,
  ErroOperacao,
  Executor,
  extrasDaContingencia,
  gravarItensLigar,
  horariosDosAtendimentos,
  lerChavesLiberacao,
  lerItensLigar,
  lerChecagemAgregada,
  lerHigienizacaoAgregada,
  lerRegistrosPorDia,
  MEDIDAS_USO,
  MEDIDAS_USO_ONDA_2,
  operacao,
  postoDaJanela,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gravarItemLigarPorFora } from '../massa/onda1-outro-sistema.js';
import { leitoLivre } from '../massa/reproducao-internacao.js';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  PODE_ESCREVER,
  partirSemDecisao,
  prepararAmbiente,
} from './escrita.spec-util.js';

const menosDe5 = (n: number) => (n < 5 ? '<5' : String(n));

async function restricao(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const nome = /CHECK constraint "?(SGH_CK_[A-Z_]+)"?/i.exec(msg)?.[1];
    return nome ? `check: ${nome.toUpperCase()}` : `outro: ${(e as Error).name}`;
  }
}

describe.skipIf(!PODE_ESCREVER)('onda 2 na cópia (M40, transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('critério do setor: grava, regrava e lê; o teste de invasão não se grava; o banco recusa o das operações', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await gravarItensLigar(
        e,
        a.cod,
        'enfermagem',
        [
          {
            item: 'unidade-piloto',
            situacao: 'cumprido',
            evidencia: 'UTI (ata 3 do comitê)',
            em: '2026-12-01',
          },
          { item: 'relatorio-contingencia', situacao: 'pendente', evidencia: '', em: null },
        ],
        'SGH.TESTE',
      );
      await gravarItensLigar(
        e,
        a.cod,
        'enfermagem',
        [
          {
            item: 'relatorio-contingencia',
            situacao: 'cumprido',
            evidencia: 'docs/marcos/M40/evidencias.md',
            em: '2026-12-02',
          },
        ],
        'SGH.TESTE',
      );
      const lidos = (await lerItensLigar(e, a.cod)).filter((x) => x.setor === 'enfermagem');
      let pentest = 'gravou';
      try {
        await gravarItensLigar(
          e,
          a.cod,
          'enfermagem',
          [{ item: 'pentest-sem-critico', situacao: 'cumprido', evidencia: 'matriz', em: '2026-12-01' }],
          'SGH.TESTE',
        );
      } catch (x) {
        pentest = (x as Error).message;
      }
      return {
        lidos: lidos.map((x) => `${x.item}=${x.situacao}@${x.em}`).sort(),
        pentest,
        operacoes: await restricao(
          gravarItemLigarPorFora(e, a.cod, 'operacoes-conferidas', 'cumprido', '2026-12-01'),
        ),
      };
    });
    expect(r.lidos).toEqual([
      'relatorio-contingencia=cumprido@2026-12-02',
      'unidade-piloto=cumprido@2026-12-01',
    ]);
    expect(r.pentest).toBe('Item calculado: não se grava.');
    expect(r.operacoes).toBe('check: SGH_CK_COEX_LIGAR_ITEM');
    console.log(`[${a.cod}] critério da onda 2: ${JSON.stringify(r)}; desfeito`);
  });

  it('chave da unidade-piloto desligada com a tela aberta: a gravação seguinte é recusada', async () => {
    const producao = new Executor({
      ambiente: 'producao',
      catalogo: { estado: () => 'liberada' },
      schema: { bloqueada: () => false },
      ler: () => Promise.reject(new Error('não usado (escritor de quem chama)')),
      escrever: () => Promise.reject(new Error('não usado (escritor de quem chama)')),
    });
    const OP = 'hotelaria.solicitarLimpeza';
    const desfechos: string[] = [];
    const naCopia = (await a.nucleo.lerSomente(ctx(a), (l) => lerChavesLiberacao(l, a.cod))).filter(
      (c) => c.chave === OP,
    );
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      // M61: a cópia pode estar com a liberação full; o teste parte do "sem chave" na própria transação.
      await partirSemDecisao(e, { rede: a.nucleo.rede, hospital: a.cod, chave: OP, tipo: 'operacao' });
      const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      const leito = await leitoLivre(e, { tipo: 1 });
      const setor = leito.bloco;
      const tentar = async (rotulo: string) => {
        try {
          await producao.executar(
            operacao(OP),
            a.cod,
            { leito, tipoLimpeza: 4, origem: 'manual' },
            { ...ctxOperacao(a, login), setor },
            { escritor: e },
          );
          desfechos.push(`${rotulo}:gravou`);
        } catch (x) {
          desfechos.push(`${rotulo}:${x instanceof ErroOperacao ? x.problema.codigo : 'outro'}`);
        }
      };
      const lote = (ligada: boolean) =>
        aplicarLoteLiberacao(
          e,
          {
            hospital: a.cod,
            tipo: 'operacao',
            chave: OP,
            planejar: (estado) => planejarLote(estado.chaves, 'setor', [setor], ligada),
            justificativa: 'teste de integração sintético da onda 2',
            autor: 'SGH.M40',
          },
          {
            rede: a.nucleo.rede,
            hospital: a.cod,
            usuario: 'SGH.M40',
            evento: 'config.liberacao.alterada',
            recurso: 'config.liberacao',
            operacao: 'config.aplicarLiberacao',
            chaveNaturalAlvo: null,
            resultado: 'sucesso',
            estacao: 'SGH-TESTE:integracao',
            correlacao: 'integracao-m40',
          },
        );
      await tentar('sem-chave');
      await lote(true);
      await tentar('piloto-ligado');
      // A tela continua aberta (o mesmo executor no ar); o coordenador desliga a chave da unidade.
      await lote(false);
      await tentar('recolhido');
      expect((await lerChavesLiberacao(e, a.cod)).some((c) => c.chave === OP)).toBe(true);
    });
    expect(desfechos).toEqual([
      'sem-chave:operacao-nao-liberada',
      'piloto-ligado:gravou',
      'recolhido:operacao-nao-liberada',
    ]);
    expect(
      (await a.nucleo.lerSomente(ctx(a), (l) => lerChavesLiberacao(l, a.cod))).filter((c) => c.chave === OP),
    ).toEqual(naCopia);
    console.log(`[${a.cod}] recolher com a tela aberta: ${desfechos.join(', ')}; desfeito`);
  }, 300_000);

  it('relatório de contingência: as leituras do posto rodam no schema real e montam o documento', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      // A unidade com mais horários numa manhã do período do dump (o relógio da cópia está depois do fim dele).
      const agora = '2026-06-03T08:00:00';
      const inicio = performance.now();
      const posto = await postoDaJanela(l, new Date(2026, 5, 3, 8), new Date(2026, 5, 3, 14), 40);
      const unidade = posto.unidade;
      const internados = posto.internados.map((x) => ({ ...x, nome: 'PACIENTE', alergia: false }));
      const lidos = await horariosDosAtendimentos(l, {
        atendimentos: internados.map((i) => i.atendimento),
        inicio: new Date(2026, 5, 2, 8),
        fim: new Date(2026, 5, 3, 14),
        teto: 3_000,
        hospital: a.cod,
      });
      const extras = await extrasDaContingencia(l, a.cod, {
        unidade,
        pacientes: internados.map((i) => i.paciente),
        atendimentos: internados.map((i) => i.atendimento),
        prescricoes: [...new Set(lidos.itens.map((h) => h.prescricao))],
      });
      const relatorio = montarRelatorioContingencia({
        unidade,
        agora,
        horas: 6,
        internados,
        alergias: extras.alergias,
        horarios: lidos.itens.filter((h) => h.faixa === null),
        cortado: lidos.cortada,
        sinais: [],
        problemas: extras.problemas,
        justificativas: extras.justificativas,
        amostras: extras.amostras,
        limpezas: extras.limpezas,
      });
      const campos = camposDoRelatorioContingencia(relatorio);
      return {
        temUnidade: unidade.length > 0,
        pacientes: relatorio.pacientes.length,
        comPrescricao: relatorio.pacientes.filter((p) => p.prescricao.length > 0).length,
        horarios: relatorio.pacientes.reduce((t, p) => t + p.horarios.length, 0),
        comAlergia: relatorio.pacientes.filter((p) => p.alergias.length > 0).length,
        campos: campos.length,
        ms: performance.now() - inicio,
      };
    });
    expect(r.temUnidade).toBe(true);
    expect(r.pacientes).toBeGreaterThan(0);
    expect(r.comPrescricao).toBeGreaterThan(0);
    expect(r.campos).toBeGreaterThan(r.pacientes * 6);
    // Teto de tempo do relatório de um posto (as leituras de 40 pacientes no máximo).
    expect(r.ms).toBeLessThan(60_000);
    console.log(
      `[${a.cod}] contingência do posto (manhã de 2026-06-03): ${menosDe5(r.pacientes)} paciente(s), ` +
        `${menosDe5(r.comPrescricao)} com prescrição, ${menosDe5(r.horarios)} horário(s) no horizonte, ` +
        `${menosDe5(r.comAlergia)} com alergia; ${r.campos} linhas do documento; ${Math.round(r.ms)} ms`,
    );
  }, 300_000);

  it('acompanhamento: checagem, higienização e registros leem agregados no schema real', async () => {
    const DE = '2026-06-01';
    const ATE = '2026-06-07';
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => ({
      checagem: indicadorChecagem(await lerChecagemAgregada(l, DE, ATE)),
      higienizacao: indicadorHigienizacao(await lerHigienizacaoAgregada(l, a.cod, DE, ATE)),
      registros: await lerRegistrosPorDia(l, a.cod, DE, ATE),
    }));
    const horarios = r.checagem.reduce((s, x) => s + x.horarios, 0);
    const checados = r.checagem.reduce((s, x) => s + x.checados, 0);
    const solicitacoes = r.higienizacao.reduce((s, x) => s + x.solicitacoes, 0);
    const avancaram = r.higienizacao.reduce((s, x) => s + x.avancaram, 0);
    const reg = registrosPorSistema(r.registros.totais, r.registros.peloNovo);
    console.log(
      `[${a.cod}] acompanhamento ${DE}..${ATE}: checagem ${horarios} horários, ${checados} checados, ` +
        `${new Set(r.checagem.map((x) => x.unidade)).size} unidades; higienização ${solicitacoes} solicitações, ` +
        `${avancaram} avançaram; evoluções ${reg.filter((x) => x.tipo === 'evolucao').reduce((s, x) => s + x.total, 0)}, ` +
        `prescrições ${reg.filter((x) => x.tipo === 'prescricao').reduce((s, x) => s + x.total, 0)}`,
    );
    expect(horarios).toBeGreaterThan(0);
    expect(checados).toBeLessThanOrEqual(horarios);
    expect(avancaram).toBeLessThanOrEqual(solicitacoes);
    for (const x of reg) expect(x.peloNovo + x.peloOutro).toBe(x.total);
  });

  it('parcela por sistema (campo 4): as medidas da onda 2 entram no uso do dia e contam no schema real', async () => {
    const DIA = '2026-06-03';
    const ops = MEDIDAS_USO_ONDA_2.map((m) => m.operacao);
    const medidas = MEDIDAS_USO.filter((m) => (ops as readonly string[]).includes(m.operacao));
    expect(medidas.map((m) => m.operacao).sort()).toEqual([...ops].sort());
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const out: { operacao: string; setor: string; linhas: number; novo: number; ms: number }[] = [];
      for (const m of medidas) {
        const t0 = performance.now();
        const c = await contarUsoDoDia(l, a.cod, m, DIA);
        out.push({
          operacao: m.operacao,
          setor: m.setor,
          linhas: c.linhasDoDia,
          novo: c.doNovo,
          ms: performance.now() - t0,
        });
      }
      return out;
    });
    console.log(
      `[${a.cod}] uso do dia ${DIA} (onda 2): ${r.map((x) => `${x.operacao}@${x.setor} ${menosDe5(x.linhas)} linhas, ${menosDe5(x.novo)} no novo, ${Math.round(x.ms)} ms`).join('; ')}`,
    );
    for (const x of r) {
      expect(x.novo, x.operacao).toBeLessThanOrEqual(Math.max(x.linhas, x.novo));
      expect(x.ms, x.operacao).toBeLessThan(60_000);
    }
    // Internação, evolução e prescrição têm movimento todo dia num hospital com internação.
    expect(r.find((x) => x.operacao === 'pep.registrarEvolucao')!.linhas).toBeGreaterThan(0);
  }, 300_000);
});
