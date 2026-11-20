// Etapa 5 do M50 sobre a cópia (ficha, seções 4, 5, 6 e 10; regra 9: "visitante com crachá e bloqueio por paciente"),
// sempre em transação desfeita e sob a trava:
//   - uma internação em aberto da cópia (só os IDs): os internados da portaria com o leito e o isolamento; os domínios do
//     controle de acesso lidos (os 6, com o fabricante do terminal);
//   - o visitante (cadastro mínimo), a visita com o crachá relida e avaliada depois da trava do paciente; o bloqueio
//     judicial do mesmo paciente faz a segunda entrada ser recusada pela releitura; a revogação libera; a saída uma vez;
//   - o acompanhante e a troca (um vigente pela chave única do banco); o terminal e a passagem na catraca (uma vez só);
//   - as chaves "uma vez só" do banco (a visita aberta, o crachá, o evento) recusam a inserção repetida;
//   - a visita vencida sem a saída (o visitante foi embora sem passar na portaria) não conta na vaga do paciente e, na
//     volta do mesmo visitante, é encerrada como expirada (correção da revisão);
//   - duas entradas ao mesmo tempo para o mesmo paciente (outra conexão, sem espera): a segunda recusa pela trava;
//   - o monitoramento da transação só com tabelas SGH_ (0 tabela legada) e o ROLLBACK conferido pelas contagens.
// Saída só com contagens, códigos e tempos (nenhum nome: os visitantes são SINTÉTICOS e o paciente fica só no ID).
import { avaliarCatraca, avaliarVisita, REGRA_PADRAO } from '@sgh/dominio-internacao';
import {
  amostraDaPortaria,
  bloquearVisitaSgh,
  bloqueiosDeVisita,
  configurarTerminalSgh,
  dominiosDaPortaria,
  encerrarVisitaSgh,
  ErroOperacao,
  escritasDaTransacao,
  internadoParaPortaria,
  internadosParaPortaria,
  regrasDeVisita,
  acompanhantesDaPortaria,
  registrarAcompanhanteSgh,
  registrarEventoCatracaSgh,
  registrarVisitaSgh,
  registrarVisitanteSgh,
  revogarBloqueioSgh,
  somenteSgh,
  type Escritor,
  type PacienteRelido,
  visitasAbertas,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const USUARIO = 'SGH.TESTE.M50';
const AGORA = '2026-07-01T15:00';

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema.codigo ?? 'sem-codigo';
    return /SGH_[A-Z_]+/.exec(String((e as Error).message))?.[0] ?? 'outro';
  }
}

/** A avaliação do domínio com o que a gravação releu (regra de mercado, sem isolamento). */
const avaliar = (r: PacienteRelido) => {
  const a = avaliarVisita({
    agora: AGORA,
    regra: REGRA_PADRAO,
    isolamento: false,
    bloqueios: r.bloqueios,
    abertas: r.abertas,
    acompanhante: r.acompanhante,
    visitante: { id: 0, nascimento: '1980-05-01', emVisita: r.visitanteEmVisita },
    biometrica: false,
    biometriaLigada: false,
    excecao: false,
  });
  return a.permitida
    ? { permitida: true as const, papel: a.papel }
    : { permitida: false as const, recusa: a.recusa, mensagem: a.mensagem };
};

const visitante = (e: Escritor, hospital: string, doc: string) =>
  registrarVisitanteSgh(e, {
    hospital,
    nome: 'VISITANTE SINTETICO M50 INTEGRACAO',
    nomeBusca: 'VISITANTE SINTETICO M50 INTEGRACAO',
    tipoDocumento: 'outro',
    documento: doc,
    nascimento: '1980-05-01',
    telefone: null,
    tipoVisitante: 6,
    fotoChave: null,
    reterAte: '2027-07-01',
    usuario: USUARIO,
  });

describe.skipIf(!PODE_ESCREVER)('M50 etapa 5 na cópia (transação desfeita)', () => {
  let a: Ambiente;

  /** As linhas do usuário do teste nas tabelas SGH_ da portaria (só contagens). */
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const contar = async (tabela: string, coluna: string) =>
        Number(
          (
            await l.consultar(`SELECT COUNT(*) N FROM ${tabela} WHERE ${coluna} = ?`, [USUARIO], { teto: 1 })
          )[0]?.['N'] ?? 0,
        );
      return {
        visitantes: await contar('SGH_HOT_VISITANTE', 'CRIADO_POR'),
        visitas: await contar('SGH_HOT_VISITA', 'USUARIO'),
        travas: await contar('SGH_HOT_VISITA_TRAVA', 'ATUALIZADO_POR'),
        bloqueios: await contar('SGH_HOT_BLOQUEIO_VISITA', 'CRIADO_POR'),
        acompanhantes: await contar('SGH_HOT_ACOMPANHANTE', 'CRIADO_POR'),
        terminais: await contar('SGH_HOT_TERMINAL', 'ATUALIZADO_POR'),
        eventos: await contar('SGH_HOT_CATRACA_EVT', 'USUARIO'),
      };
    });

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('visita com crachá, bloqueio relido na transação, acompanhante com troca, catraca uma vez só; só SGH_', async () => {
    const inicio = Date.now();
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e0) => {
      const p = await amostraDaPortaria(e0);
      if (!p) throw new Error('Nenhuma internação em aberto na cópia.');
      const internados = await internadosParaPortaria(e0, a.cod);
      const lido = await internadoParaPortaria(e0, a.cod, p.internacao);
      const d = await dominiosDaPortaria(e0);
      const e = somenteSgh(e0);
      const v1 = await visitante(e, a.cod, 'SINTM50I01');
      const v2 = await visitante(e, a.cod, 'SINTM50I02');
      const destino = {
        tipo: 'paciente' as const,
        internacao: p.internacao,
        paciente: p.paciente,
        bloco: p.bloco,
        acomod: p.acomod,
        leito: p.leito,
      };
      const base = {
        hospital: a.cod,
        destino,
        tipoVisitado: 4,
        identificacao: 2,
        situacaoAcesso: 3,
        entrada: AGORA,
        validoAte: '2026-07-01T17:00',
        excecao: null,
        reterAte: '2027-07-01',
        usuario: USUARIO,
        chave: null,
      };
      const visita1 = await registrarVisitaSgh(
        e,
        { ...base, visitante: v1.id, cracha: 'SINTM50I0001' },
        avaliar,
      );
      const segunda = await codigo(
        registrarVisitaSgh(e, { ...base, visitante: v1.id, cracha: 'SINTM50I0002' }, avaliar),
      );
      // O bloqueio judicial (todos): a próxima entrada é recusada pela releitura na transação.
      const bloqueio = await bloquearVisitaSgh(e, {
        hospital: a.cod,
        internacao: p.internacao,
        paciente: p.paciente,
        motivo: 'judicial',
        abrangencia: 'todos',
        visitante: null,
        limite: null,
        incluiAcompanhante: false,
        justificativa: 'Ordem SINTETICA do teste de integracao',
        documento: 'PROC-SINT-M50-I',
        inicio: '2026-07-01T14:00',
        fim: null,
        usuario: USUARIO,
      });
      const comBloqueio = await codigo(
        registrarVisitaSgh(e, { ...base, visitante: v2.id, cracha: 'SINTM50I0003' }, avaliar),
      );
      const bloqueiosLidos = (await bloqueiosDeVisita(e0, a.cod, p.internacao)).filter(
        (b) => b.id === bloqueio,
      ).length;
      await revogarBloqueioSgh(e, {
        hospital: a.cod,
        id: bloqueio,
        motivo: 'Revogacao SINTETICA do teste',
        usuario: USUARIO,
        podeClinico: false,
      });
      const revogado = await registrarVisitaSgh(
        e,
        { ...base, visitante: v2.id, cracha: 'SINTM50I0004' },
        avaliar,
      );
      // A saída uma vez só.
      const saida = {
        hospital: a.cod,
        id: visita1.id,
        saida: '2026-07-01T16:00',
        origem: 'portaria' as const,
        usuario: USUARIO,
      };
      await encerrarVisitaSgh(e, saida);
      const segundaSaida = await codigo(encerrarVisitaSgh(e, saida));
      // As abertas do teste pela própria linha (as visitas do teste são de 01/07: a lista da portaria só mostra as das
      // últimas 24 horas).
      const abertasDoTeste = async () =>
        Number(
          (
            await e0.consultar(
              'SELECT COUNT(*) N FROM SGH_HOT_VISITA WHERE USUARIO = ? AND SAIDA_EM IS NULL',
              [USUARIO],
              { teto: 1 },
            )
          )[0]?.['N'] ?? 0,
        );
      const abertas = await abertasDoTeste();
      // O acompanhante e a troca.
      const acomp = {
        hospital: a.cod,
        internacao: p.internacao,
        paciente: p.paciente,
        bloco: p.bloco,
        fundamento: 'autorizado' as const,
        refeicao: true,
        pernoite: false,
        observacao: null,
        inicio: AGORA,
        usuario: USUARIO,
      };
      const a1 = await registrarAcompanhanteSgh(e, { ...acomp, visitante: v1.id });
      const a2 = await registrarAcompanhanteSgh(e, { ...acomp, visitante: v2.id });
      // O terminal e a catraca: a saída do visitante 2 pela catraca, uma vez só.
      const t = await configurarTerminalSgh(e, {
        hospital: a.cod,
        id: null,
        versao: null,
        nome: 'CATRACA SINTETICA M50 INTEGRACAO',
        tipoTerminal: 1,
        fabricante: 1,
        local: 'PORTARIA SINTETICA',
        sentido: 'ambos',
        ativo: true,
        usuario: USUARIO,
      });
      const ev = {
        hospital: a.cod,
        terminal: t.id,
        cracha: 'SINTM50I0004',
        sentido: 'saida' as const,
        ocorridoEm: '2026-07-01T16:30',
        chave: 'sint-m50-i-1',
        usuario: USUARIO,
      };
      const pela = (x: Parameters<Parameters<typeof registrarEventoCatracaSgh>[2]>[0]) =>
        avaliarCatraca({ visita: x.visita, agora: ev.ocorridoEm, sentido: ev.sentido, terminal: x.terminal });
      const c1 = await registrarEventoCatracaSgh(e, ev, pela);
      const c2 = await registrarEventoCatracaSgh(e, ev, pela);
      const depoisCatraca = await abertasDoTeste();
      // As chaves do banco: a inserção repetida direta é recusada (a visita aberta, o crachá).
      const provas = {
        aberta: await codigo(
          registrarVisitaSgh(e, { ...base, visitante: v2.id, cracha: 'SINTM50I0005' }, () => ({
            permitida: true,
            papel: 'visitante',
          })).then(() =>
            registrarVisitaSgh(e, { ...base, visitante: v2.id, cracha: 'SINTM50I0006' }, () => ({
              permitida: true,
              papel: 'visitante',
            })),
          ),
        ),
        cracha: await codigo(
          registrarVisitaSgh(e, { ...base, visitante: v1.id, cracha: 'SINTM50I0005' }, () => ({
            permitida: true,
            papel: 'visitante',
          })),
        ),
      };
      // A visita vencida sem a saída: às 18 h, as visitas abertas das 15 h (válidas até as 17 h) não ocupam a vaga; o
      // mesmo visitante volta e a anterior é encerrada como expirada (na validade do crachá).
      const v3 = await visitante(e, a.cod, 'SINTM50I03');
      const v4 = await visitante(e, a.cod, 'SINTM50I04');
      const tarde = { ...base, entrada: '2026-07-01T18:00', validoAte: '2026-07-01T20:00' };
      const vencida = await registrarVisitaSgh(
        e,
        { ...base, visitante: v3.id, cracha: 'SINTM50I0007' },
        avaliar,
      );
      let abertasAs18 = -1;
      await registrarVisitaSgh(e, { ...tarde, visitante: v4.id, cracha: 'SINTM50I0008' }, (x) => {
        abertasAs18 = x.abertas;
        return avaliar(x);
      });
      const reentrada = await codigo(
        registrarVisitaSgh(e, { ...tarde, visitante: v3.id, cracha: 'SINTM50I0009' }, avaliar),
      );
      const [exp] = await e0.consultar(
        'SELECT SAIDA_ORIGEM, SAIDA_EM, VALIDO_ATE FROM SGH_HOT_VISITA WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
        [String(vencida.id)],
        { teto: 1 },
      );
      const expirada = {
        origem: String(exp?.['SAIDA_ORIGEM'] ?? '').trim(),
        naValidade: String(exp?.['SAIDA_EM']) === String(exp?.['VALIDO_ATE']),
      };
      const tabelas = (await escritasDaTransacao(e0)).map((w) => w.tabela);
      return {
        internados: internados.length > 0,
        lidoComLeito: lido !== null && lido.leito.length > 0,
        dominios: [
          d.tiposVisitante.length,
          d.tiposVisitado.length,
          d.identificacoes.length,
          d.situacoesAcesso.length,
          d.tiposTerminal.length,
        ],
        fabricante: d.tiposTerminal.every((x) => x.fabricanteNome !== ''),
        papel: visita1.papel,
        segunda,
        comBloqueio,
        bloqueiosLidos,
        revogado: revogado.id > 0,
        segundaSaida,
        abertas,
        troca: a2.substituido === a1.id,
        catraca: [c1.resultado, c1.repetido, c2.repetido, c2.id === c1.id],
        depoisCatraca,
        provas,
        abertasAs18,
        reentrada,
        expirada,
        tabelas,
      };
    });
    const depois = await retrato();
    console.log(JSON.stringify({ ...r, antes, depois, ms: Date.now() - inicio }));
    expect(r).toEqual({
      internados: true,
      lidoComLeito: true,
      dominios: [8, 6, 4, 3, 6],
      fabricante: true,
      papel: 'visitante',
      segunda: 'ja-em-visita',
      comBloqueio: 'bloqueio',
      bloqueiosLidos: 1,
      revogado: true,
      segundaSaida: 'visita-encerrada',
      abertas: 1,
      troca: true,
      catraca: ['liberado', false, true, true],
      depoisCatraca: 0,
      provas: { aberta: 'ja-em-visita', cracha: 'cracha-repetido' },
      abertasAs18: 0,
      reentrada: 'gravou',
      expirada: { origem: 'expirada', naValidade: true },
      tabelas: [
        'SGH_HOT_ACOMPANHANTE',
        'SGH_HOT_BLOQUEIO_VISITA',
        'SGH_HOT_CATRACA_EVT',
        'SGH_HOT_TERMINAL',
        'SGH_HOT_VISITA',
        'SGH_HOT_VISITA_TRAVA',
        'SGH_HOT_VISITANTE',
      ],
    });
    expect(depois).toEqual(antes);
  });

  it('duas entradas ao mesmo tempo para o mesmo paciente: a segunda recusa pela trava (sem espera)', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e1) => {
      const p = await amostraDaPortaria(e1);
      if (!p) throw new Error('Nenhuma internação em aberto na cópia.');
      const destino = {
        tipo: 'paciente' as const,
        internacao: p.internacao,
        paciente: p.paciente,
        bloco: p.bloco,
        acomod: p.acomod,
        leito: p.leito,
      };
      const base = {
        hospital: a.cod,
        destino,
        tipoVisitado: 4,
        identificacao: 2,
        situacaoAcesso: 3,
        entrada: AGORA,
        validoAte: '2026-07-01T17:00',
        excecao: null,
        reterAte: '2027-07-01',
        usuario: USUARIO,
        chave: null,
      };
      const e = somenteSgh(e1);
      const v = await visitante(e, a.cod, 'SINTM50C01');
      await registrarVisitaSgh(e, { ...base, visitante: v.id, cracha: 'SINTM50C0001' }, avaliar);
      // A outra transação (outra conexão, sem espera) tenta a entrada no mesmo paciente com a trava ocupada.
      const inicio = Date.now();
      const mesma = await codigo(
        a.nucleo.desfazendoNaCopia(
          ctx(a),
          async (e2) => {
            const x = somenteSgh(e2);
            const w = await visitante(x, a.cod, 'SINTM50C02');
            return registrarVisitaSgh(x, { ...base, visitante: w.id, cracha: 'SINTM50C0002' }, avaliar);
          },
          { semEspera: true },
        ),
      );
      return { mesma, menosDe5s: Date.now() - inicio < 5_000 };
    });
    console.log(JSON.stringify({ ...r, antes, depois: await retrato() }));
    expect(r).toEqual({ mesma: 'portaria-em-uso', menosDe5s: true });
    expect(await retrato()).toEqual(antes);
  });

  it('o tempo da consulta "visita permitida para um paciente" (a internação, as regras, os bloqueios, as visitas abertas e o acompanhante; 30 vezes)', async () => {
    const tempos: number[] = [];
    await a.nucleo.lerSomente(ctx(a), async (l) => {
      const p = await amostraDaPortaria(l);
      if (!p) throw new Error('Nenhuma internação em aberto na cópia.');
      for (let i = 0; i < 30; i++) {
        const t0 = performance.now();
        await Promise.all([
          internadoParaPortaria(l, a.cod, p.internacao),
          regrasDeVisita(l, a.cod),
          bloqueiosDeVisita(l, a.cod, p.internacao),
          visitasAbertas(l, a.cod),
          acompanhantesDaPortaria(l, a.cod, p.bloco),
        ]);
        tempos.push(performance.now() - t0);
      }
    });
    const ordenados = [...tempos].sort((x, y) => x - y);
    const p95 = ordenados[Math.ceil(0.95 * ordenados.length) - 1]!;
    console.log(
      JSON.stringify({ consultas: tempos.length, p50: Math.round(ordenados[14]!), p95: Math.round(p95) }),
    );
    // Meta a propor da ficha (seção 4): p95 < 300 ms; o teste falha só acima de 1 s (a VM é compartilhada).
    expect(p95).toBeLessThan(1_000);
  });
});
