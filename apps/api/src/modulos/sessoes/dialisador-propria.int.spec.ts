// Contrato de efeito do reuso do dialisador (03-PEP linha 146) contra o MariaDB real (cliente de teste). Massa
// SINTÉTICA: estabelecimento com o código do teste; usuário, profissional e dois pacientes são ids já existentes do
// cliente de teste (só lidos, nunca alterados). Sem vínculo vigente entre usuário e profissional no cliente, o teste cria
// um vínculo sintético (vigência marcada em VIGENCIA_MASSA) e o apaga na limpeza.
// Prova o que fica no banco: a abertura com o teto do método, um em uso por paciente, a etiqueta única e o limite acima
// do teto recusados; o reprocessamento aprovado (sequência, volumes, testes, responsável e reuso somado), o reprovado
// (gravado, sem somar), o cancelamento só do último (devolve o reuso do aprovado), a versão conferida, o volume abaixo
// de 80% que descarta o dialisador na mesma transação, a recusa depois do descarte, a desativação só do aberto por
// engano e a trilha das operações. Nada é apagado.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaDialisadorPropria } from './dialisador-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const P = 'c1096dial';
/** Marca do vínculo usuário-profissional sintético (só quando o cliente não tem um vigente). */
const VIGENCIA_MASSA = '1909-06-01';

interface Massa {
  est: number;
  usuario: number;
  profissional: number;
  pac1: number;
  pac2: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE r FROM reuso_dialisador r JOIN dialisador d ON d.id = r.dialisador_id WHERE d.estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM dialisador WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar('DELETE FROM usuario_profissional WHERE vigencia_inicio = ?', [VIGENCIA_MASSA]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaDialisadorPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaDialisadorPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const dial = async (id: number) =>
    (
      await ler(
        `SELECT situacao, limite_reusos, reusos_realizados, metodo_limpeza, volume_inicial_ml, aberto_por_usuario_id,
                fechado_em, fechado_por_usuario_id, motivo_descarte, desativado_em, motivo_desativacao, versao
           FROM dialisador WHERE id = ?`,
        [id],
      )
    )[0]!;
  const reusos = (id: number) =>
    ler(
      `SELECT id, sequencia, volume_priming_inicial_ml, volume_priming_atual_ml, teste_peroxido_pre_lavagem,
              teste_peroxido_pos_lavagem, aprovado, responsavel_profissional_id, sessao_hemodialise_id, situacao,
              motivo_cancelamento, versao
         FROM reuso_dialisador WHERE dialisador_id = ? ORDER BY sequencia`,
      [id],
    );
  const bom = (versao: number, x: Record<string, unknown> = {}) => ({
    metodo: 'automatizado',
    volumeAtualMl: 95,
    testePreEnxague: 'positivo',
    testePosEnxague: 'negativo',
    agente: 'Ácido peracético',
    versao,
    ...x,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      let vinc = await e.uma(
        `SELECT up.usuario_id, up.profissional_id FROM usuario_profissional up
           JOIN usuario u ON u.id = up.usuario_id AND u.excluido_em IS NULL
          WHERE up.usuario_vigente_id IS NOT NULL ORDER BY up.usuario_id LIMIT 1`,
      );
      if (!vinc) {
        const u = await e.uma(
          `SELECT MIN(u.id) AS id FROM usuario u WHERE u.excluido_em IS NULL
              AND NOT EXISTS (SELECT 1 FROM usuario_profissional x WHERE x.usuario_vigente_id = u.id)`,
        );
        const pr = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
        if (u?.['id'] && pr?.['id']) {
          await e.inserir(
            'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
            [u['id'], pr['id'], VIGENCIA_MASSA, agora],
          );
          vinc = { usuario_id: u['id'], profissional_id: pr['id'] };
        }
      }
      const pacs = await e.consultar('SELECT id FROM paciente WHERE excluido_em IS NULL ORDER BY id LIMIT 2');
      if (!vinc?.['usuario_id'] || pacs.length < 2)
        throw new Error('O cliente de teste precisa de usuário, profissional e dois pacientes.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      return {
        est,
        usuario: Number(vinc['usuario_id']),
        profissional: Number(vinc['profissional_id']),
        pac1: Number(pacs[0]!['id']),
        pac2: Number(pacs[1]!['id']),
      };
    });
    porta = new PortaDialisadorPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('abertura: teto do método, um em uso por paciente, etiqueta única e limite acima do teto recusados', async () => {
    const a = await porta.abrir(ctx(), {
      paciente: m.pac1,
      identificacao: `${P}-A`,
      metodo: 'automatizado',
      volumeInicialMl: 100,
    });
    expect(a.limiteReusos).toBe(20);
    expect(await dial(a.id)).toMatchObject({
      situacao: 'em_uso',
      limite_reusos: 20,
      reusos_realizados: 0,
      metodo_limpeza: 'automatizado',
      aberto_por_usuario_id: m.usuario,
      versao: 1,
    });
    expect(Number((await dial(a.id))['volume_inicial_ml'])).toBe(100);
    // Segundo em uso do mesmo paciente: recusa (422), nada gravado.
    await expect(
      porta.abrir(ctx(), {
        paciente: m.pac1,
        identificacao: `${P}-B`,
        metodo: 'manual',
        volumeInicialMl: 90,
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    // Etiqueta repetida em outro paciente e limite manual acima de 12: recusa.
    await expect(
      porta.abrir(ctx(), {
        paciente: m.pac2,
        identificacao: `${P}-A`,
        metodo: 'manual',
        volumeInicialMl: 90,
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.abrir(ctx(), {
        paciente: m.pac2,
        identificacao: `${P}-C`,
        metodo: 'manual',
        limiteReusos: 13,
        volumeInicialMl: 90,
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const [n] = await ler('SELECT COUNT(*) AS n FROM dialisador WHERE estabelecimento_id = ?', [m.est]);
    expect(Number(n!['n'])).toBe(1);
    const lidos = await porta.doPaciente(ctx(), m.pac1);
    expect(lidos.map((x) => x.identificacao)).toEqual([`${P}-A`]);
    expect((await porta.emUso(ctx())).map((x) => x.id)).toEqual([a.id]);
  });

  it('reprocessamento: aprovado soma, reprovado não soma, cancela só o último, versão conferida, volume < 80% descarta', async () => {
    const [d] = await ler('SELECT id FROM dialisador WHERE estabelecimento_id = ? AND paciente_id = ?', [
      m.est,
      m.pac1,
    ]);
    const id = Number(d!['id']);
    const r1 = await porta.reprocessar(ctx(), id, bom(1));
    expect(r1).toMatchObject({ sequencia: 1, aprovado: true, descartado: false, reusosRealizados: 1 });
    expect(await dial(id)).toMatchObject({ reusos_realizados: 1, versao: 2, situacao: 'em_uso' });
    // Resíduo do desinfetante depois do enxágue: grava reprovado, não soma nem mexe no dialisador.
    const r2 = await porta.reprocessar(ctx(), id, bom(2, { testePosEnxague: 'positivo' }));
    expect(r2).toMatchObject({ sequencia: 2, aprovado: false, descartado: false, reusosRealizados: 1 });
    expect(await dial(id)).toMatchObject({ reusos_realizados: 1, versao: 2 });
    let rs = await reusos(id);
    expect(rs).toHaveLength(2);
    expect(rs[0]).toMatchObject({
      sequencia: 1,
      volume_priming_inicial_ml: 100,
      volume_priming_atual_ml: 95,
      teste_peroxido_pre_lavagem: 'positivo',
      teste_peroxido_pos_lavagem: 'negativo',
      responsavel_profissional_id: m.profissional,
      sessao_hemodialise_id: null,
      situacao: 'valido',
    });
    expect(Boolean(rs[0]!['aprovado'])).toBe(true);
    expect(Boolean(rs[1]!['aprovado'])).toBe(false);
    // Só o último válido se cancela: o primeiro é recusado; o segundo (reprovado) cancela sem devolver reuso.
    await expect(
      porta.cancelarReprocessamento(ctx(), r1.id, { motivo: 'Lançado por engano', versao: 1 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await porta.cancelarReprocessamento(ctx(), r2.id, { motivo: 'Lançado por engano', versao: 1 });
    expect(await dial(id)).toMatchObject({ reusos_realizados: 1 });
    // Agora o primeiro é o último válido: cancelar devolve o reuso.
    await porta.cancelarReprocessamento(ctx(), r1.id, { motivo: 'Paciente trocado na etiqueta', versao: 1 });
    expect(await dial(id)).toMatchObject({ reusos_realizados: 0, versao: 3 });
    rs = await reusos(id);
    expect(rs.map((x) => x['situacao'])).toEqual(['cancelado', 'cancelado']);
    expect(rs[1]!['motivo_cancelamento']).toBe('Lançado por engano');
    // Versão velha do dialisador: conflito (409), nada gravado.
    await expect(porta.reprocessar(ctx(), id, bom(2))).rejects.toMatchObject({ problema: { status: 409 } });
    expect(await reusos(id)).toHaveLength(2);
    // Volume a 79% do inicial: grava reprovado e descarta o dialisador na mesma transação, com o motivo.
    const r3 = await porta.reprocessar(ctx(), id, bom(3, { volumeAtualMl: 79 }));
    expect(r3).toMatchObject({ sequencia: 3, aprovado: false, descartado: true });
    const fim = await dial(id);
    expect(fim).toMatchObject({ situacao: 'descartado', fechado_por_usuario_id: m.usuario });
    expect(fim['fechado_em']).not.toBeNull();
    expect(String(fim['motivo_descarte'])).toMatch(/79%/);
    // Depois do descarte: nem reprocessa nem cancela (o histórico fica).
    await expect(porta.reprocessar(ctx(), id, bom(4))).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.cancelarReprocessamento(ctx(), r3.id, { motivo: 'Tentativa indevida', versao: 1 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await reusos(id)).toHaveLength(3);
    const lido = (await porta.doPaciente(ctx(), m.pac1))[0]!;
    expect(lido).toMatchObject({ situacao: 'descartado', reusosRealizados: 0 });
    expect(lido.reprocessamentos.map((x) => x.sequencia)).toEqual([3, 2, 1]);
    expect(await porta.emUso(ctx())).toEqual([]);
  });

  it('desativação só do aberto por engano; descarte manual com motivo; trilha das operações', async () => {
    const b = await porta.abrir(ctx(), {
      paciente: m.pac1,
      identificacao: `${P}-D`,
      metodo: 'manual',
      volumeInicialMl: 90,
    });
    expect(b.limiteReusos).toBe(12);
    await porta.desativar(ctx(), b.id, { motivo: 'Etiqueta do paciente trocada', versao: 1 });
    expect(await dial(b.id)).toMatchObject({
      situacao: 'desativado',
      motivo_desativacao: 'Etiqueta do paciente trocada',
    });
    const c = await porta.abrir(ctx(), {
      paciente: m.pac2,
      identificacao: `${P}-E`,
      metodo: 'manual',
      volumeInicialMl: 90,
    });
    await porta.reprocessar(ctx(), c.id, bom(1, { metodo: 'manual', volumeAtualMl: 88 }));
    await expect(
      porta.desativar(ctx(), c.id, { motivo: 'Aberto por engano', versao: 2 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await porta.descartar(ctx(), c.id, { motivo: 'Fibras com coágulo visível', versao: 2 });
    expect(await dial(c.id)).toMatchObject({
      situacao: 'descartado',
      motivo_descarte: 'Fibras com coágulo visível',
    });
    const [tr] = await ler(
      `SELECT COUNT(*) AS n FROM trilha_auditoria
        WHERE estabelecimento_id = ? AND usuario_id = ? AND entidade IN ('dialisador', 'reuso_dialisador')`,
      [m.est, m.usuario],
    );
    expect(Number(tr!['n'])).toBeGreaterThan(5);
  });
});
