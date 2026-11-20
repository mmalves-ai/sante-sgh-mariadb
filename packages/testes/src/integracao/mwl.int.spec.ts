// Etapa 3 do M47 sobre a cópia (ficha, seções 4, 9 e 10; regra 8, `mwl.int-spec.ts` da ficha), sempre em transação
// desfeita e sob a trava:
//   - a worklist de imagem a enviar: os exames de imagem lançados (reais da cópia, só os IDs em memória) sem item na
//     janela, pelo índice de data e ato, dentro do tempo-alvo (p95 < 1 s; teto 500);
//   - o item da MWL de um exame real com o número de acesso pelo ID e o evento da SGH_OUTBOX na MESMA transação (carga
//     só com IDs e códigos); o mesmo exame recusado; o reenvio com o mesmo número de acesso e a colisão do envio visto;
//   - o simulador DICOM recebe o item montado com os dados reais do exame (nada impresso) e o reenvio o atualiza, sem
//     duplicar;
//   - o MPPS fora de ordem (o concluído antes do em andamento): registrado, sem rebaixar o status; a mensagem repetida
//     devolve a primeira; o link do estudo pela leitura do exame dentro do tempo-alvo (p95 < 500 ms);
//   - o monitoramento da transação mostra só tabelas SGH_ (0 tabela legada).
// Saída só com contagens, códigos e tempos (nenhum nome).
import { EVENTO_OUTBOX_MWL } from '@sgh/contratos';
import {
  accessionDoItem,
  chaveIdempotenciaMwl,
  chaveNaturalExame,
  itemMwlDicom,
  lerModalidadePorSetor,
  linkDoVisualizador,
  modalidadeDoExame,
  SimuladorModalidade,
  statusVigente,
} from '@sgh/dominio-sadt';
import {
  diaComExamesDeImagem,
  ErroOperacao,
  escritasDaTransacao,
  examesDoSetor,
  examesImagemSemItem,
  examesSadtPorId,
  itensMwlDosExames,
  modalidadeDoCadastroDosExames,
  modalidadesDicom,
  reenviarItemMwlSgh,
  registrarItemMwlSgh,
  registrarStatusEstudoSgh,
  somenteSgh,
  statusDosExames,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const USUARIO = 'SGH.TESTE.M47';
const ATOS = [16, 24, 25, 26, 27, 42];
const POR_SETOR = lerModalidadePorSetor('16:CR;24:US;25:CT;26:MR;27:US;42:OT');

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).message}`;
  }
}

/** A janela de 7 dias até o dia (a geração automática aceita até 30). */
const semanaAntes = (dia: string) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
};
const p95 = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? 0;

describe.skipIf(!PODE_ESCREVER)('M47 etapa 3 na cópia: lista de trabalho DICOM (transação desfeita)', () => {
  let a: Ambiente;
  let dia = '';

  beforeAll(async () => {
    a = await prepararAmbiente();
    // O dia mais recente com 20 exames de imagem lançados ou mais na cópia (agregado; só a data).
    dia = (await a.nucleo.lerSomente(ctx(a), (l) => diaComExamesDeImagem(l, '2026-01-01'))) ?? '';
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('a worklist a enviar (7 dias) e a lista do dia dentro do tempo-alvo (p95 < 1 s; teto 500)', async () => {
    expect(dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tempos: number[] = [];
    const diaTempos: number[] = [];
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const p = await a.nucleo.lerSomente(ctx(a), (l) =>
        examesImagemSemItem(l, a.cod, { desde: semanaAntes(dia), ate: dia, atos: ATOS, teto: 500 }),
      );
      tempos.push(performance.now() - t0);
      n = p.itens.length;
      const t1 = performance.now();
      await a.nucleo.lerSomente(ctx(a), (l) =>
        examesDoSetor(l, a.cod, { setor: 'imagem', inicio: dia, fim: dia }),
      );
      diaTempos.push(performance.now() - t1);
    }
    console.info(
      `[M47.3] worklist a enviar: ${n} exame(s) em 7 dias; p95 ${p95(tempos).toFixed(0)} ms; lista do dia p95 ${p95(diaTempos).toFixed(0)} ms`,
    );
    expect(n).toBeGreaterThan(0);
    expect(p95(tempos)).toBeLessThan(1000);
    expect(p95(diaTempos)).toBeLessThan(1000);
  });

  it('a busca da lista do dia: o setor (um ato) e o termo vão à consulta (só os do ato; termo sem paciente, nada)', async () => {
    const todos = await a.nucleo.lerSomente(ctx(a), (l) =>
      examesDoSetor(l, a.cod, { setor: 'imagem', inicio: dia, fim: dia }),
    );
    const ato = todos.itens[0]!.ato;
    const t0 = performance.now();
    const doAto = await a.nucleo.lerSomente(ctx(a), (l) =>
      examesDoSetor(l, a.cod, { setor: 'imagem', inicio: dia, fim: dia, ato }),
    );
    const ms = performance.now() - t0;
    const nada = await a.nucleo.lerSomente(ctx(a), (l) =>
      examesDoSetor(l, a.cod, { setor: 'imagem', inicio: dia, fim: dia, termo: 'QQXZWYKJ' }),
    );
    console.info(
      `[M47.3] lista do dia por setor: ${doAto.itens.length >= 5 ? doAto.itens.length : '<5'} exame(s) em ${ms.toFixed(0)} ms`,
    );
    expect(doAto.itens.length).toBeGreaterThan(0);
    expect(doAto.itens.every((x) => x.ato === ato)).toBe(true);
    expect(nada.itens).toEqual([]);
    expect(ms).toBeLessThan(1000);
  });

  it('regra 8: o item com a outbox, o reenvio sem duplicar no simulador, o MPPS fora de ordem, a repetida; 0 tabela legada', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const s = somenteSgh(e);
      const pend = await examesImagemSemItem(e, a.cod, { desde: dia, ate: dia, atos: ATOS, teto: 50 });
      const ids = pend.itens.map((x) => x.exame);
      const [exames, cadastro, modalidades] = await Promise.all([
        examesSadtPorId(e, a.cod, ids),
        modalidadeDoCadastroDosExames(e, ids),
        modalidadesDicom(e),
      ]);
      const x = exames.find((y) =>
        modalidadeDoExame(
          { ato: y.ato, modalidadeCadastro: cadastro.get(y.id) ?? null },
          POR_SETOR,
          modalidades,
        ),
      );
      if (!x) throw new Error('Nenhum exame de imagem com modalidade no dia.');
      const mod = modalidadeDoExame(
        { ato: x.ato, modalidadeCadastro: cadastro.get(x.id) ?? null },
        POR_SETOR,
        modalidades,
      )!;
      const item = {
        hospital: a.cod,
        rede: a.nucleo.rede,
        exame: x.id,
        paciente: x.paciente.id,
        chaveNatural: chaveNaturalExame(x.chave),
        ato: x.ato,
        modalidade: mod,
        accession: (id: number) => accessionDoItem(a.cod, id),
        chaveIdempotencia: chaveIdempotenciaMwl(a.cod, x.id),
        origem: 'automatico' as const,
        por: USUARIO,
      };
      const ida = await registrarItemMwlSgh(s, item);
      const [ob] = await e.consultar(
        'SELECT TIPO, CARGA FROM SGH_OUTBOX WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
        [ida.outbox],
        { teto: 1 },
      );
      const carga = JSON.parse(String(ob?.['CARGA'] ?? '{}')) as Record<string, unknown>;
      const repetido = await codigo(registrarItemMwlSgh(s, item));
      // O simulador DICOM recebe o item montado com os dados reais (em memória; nada impresso).
      const sim = new SimuladorModalidade();
      const dicom = () =>
        itemMwlDicom({
          accession: ida.accession,
          hospital: a.cod,
          modalidade: mod.sigla,
          estacao: mod.sigla,
          paciente: {
            id: x.paciente.prontuario,
            nome: x.paciente.nome,
            nascimento: x.paciente.nascimento,
            sexo: x.paciente.sexo,
          },
          exame: { codigo: x.exame.codigo, nome: x.exame.nome },
          agendadoPara: x.pedidoEm ?? `${x.chave.data.slice(0, 10)}T00:00`,
          urgente: x.urgente,
          solicitante: x.solicitante || null,
        });
      const primeira = sim.receber(dicom()).situacao;
      const re = await reenviarItemMwlSgh(s, {
        hospital: a.cod,
        rede: a.nucleo.rede,
        id: ida.id,
        envios: 1,
        exame: x.id,
        accession: ida.accession,
        modalidade: mod.sigla,
        por: USUARIO,
      });
      const segunda = sim.receber(dicom()).situacao;
      const colisao = await codigo(
        reenviarItemMwlSgh(s, {
          hospital: a.cod,
          rede: a.nucleo.rede,
          id: ida.id,
          envios: 1,
          exame: x.id,
          accession: ida.accession,
          modalidade: mod.sigla,
          por: USUARIO,
        }),
      );
      // MPPS fora de ordem: o concluído chega antes do em andamento; depois, o concluído repetido.
      const concluido = sim.status(ida.accession, 'concluido', `${dia}T10:30:00`);
      const andamento = sim.status(ida.accession, 'em-andamento', `${dia}T10:00:00`);
      const st = (m: typeof concluido) =>
        registrarStatusEstudoSgh(s, {
          hospital: a.cod,
          mwl: ida.id,
          exame: x.id,
          accession: ida.accession,
          status: m.status,
          uidEstudo: m.uidEstudo,
          uidMpps: m.uidMpps,
          ocorridoEm: m.ocorridoEm,
          visualizador: 1,
          chaveMensagem: m.mensagem,
          origem: 'simulador',
          por: 'INTG.pacs-simulador',
        });
      const c1 = await st(concluido);
      const a1 = await st(andamento);
      const c2 = await st(concluido);
      const tLink: number[] = [];
      let link: string | null = null;
      let entrega: unknown = 'x';
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const [itens, status] = await Promise.all([
          itensMwlDosExames(e, a.cod, [x.id]),
          statusDosExames(e, a.cod, [x.id]),
        ]);
        tLink.push(performance.now() - t0);
        const v = statusVigente(status);
        link = linkDoVisualizador(
          'https://visualizador.exemplo/estudo?uid={estudo}',
          v?.uidEstudo ?? null,
          itens[0]!.accession,
        );
        entrega = itens[0]!.entrega;
      }
      const status = await statusDosExames(e, a.cod, [x.id]);
      const tabelas = (await escritasDaTransacao(e)).map((w) => w.tabela).sort();
      return {
        ida,
        outbox: { tipo: String(ob?.['TIPO'] ?? '').trim(), carga },
        repetido,
        primeira,
        segunda,
        simulados: sim.itens().length,
        re,
        colisao,
        c1: c1.repetida,
        a1: a1.repetida,
        c2: { repetida: c2.repetida, mesmo: c2.estudo.id === c1.estudo.id },
        mensagens: status.length,
        vigente: statusVigente(status)?.status,
        link,
        entrega,
        tLink: p95(tLink),
        tabelas,
        exame: x.id,
      };
    });
    console.info(
      `[M47.3] item ${r.ida.accession}: outbox ${r.outbox.tipo}; reenvio ${r.re.envios}; simulador ${r.simulados} item; ${r.mensagens} mensagem(ns), vigente ${r.vigente}; link p95 ${r.tLink.toFixed(0)} ms; tabelas ${r.tabelas.join(',')}`,
    );
    expect(r.ida.accession).toMatch(new RegExp(`^${a.cod.toUpperCase().slice(0, 3)}\\d{9,}$`));
    expect(r.outbox.tipo).toBe(EVENTO_OUTBOX_MWL);
    expect(r.outbox.carga).toEqual({
      exame: r.exame,
      mwl: String(r.ida.id),
      accession: r.ida.accession,
      envio: 1,
      modalidade: expect.stringMatching(/^[A-Z]{2,8}$/),
    });
    expect(r.repetido).toBe('ja-na-worklist');
    expect([r.primeira, r.segunda, r.simulados]).toEqual(['criado', 'atualizado', 1]);
    expect(r.re.envios).toBe(2);
    expect(r.colisao).toBe('mwl-desatualizado');
    expect([r.c1, r.a1, r.c2]).toEqual([false, false, { repetida: true, mesmo: true }]);
    expect(r.mensagens).toBe(2);
    expect(r.vigente).toBe('concluido');
    expect(r.link).toMatch(/^https:\/\/visualizador\.exemplo\/estudo\?uid=2\.25\.\d+$/);
    // Sem parceiro de integração ativo na cópia: o evento fica na outbox e a entrega ainda não existe.
    expect(r.entrega).toBeNull();
    expect(r.tLink).toBeLessThan(500);
    for (const t of r.tabelas) expect(t).toMatch(/^SGH_/);
    expect(r.tabelas).toEqual(
      expect.arrayContaining(['SGH_OUTBOX', 'SGH_SADT_PACS_ESTUDO', 'SGH_SADT_PACS_MWL']),
    );
  });
});
