// Contrato de efeito dos parâmetros da integração prescrição × estoque (F3.6, 05-SUP linha 7) contra o MariaDB real
// (cliente f22_o2). Massa SINTÉTICA com o código "F36PAR" (nenhuma pessoa real): dois estabelecimentos, uma unidade
// de internação, dois locais de estoque (e um de outro estabelecimento) e duas frequências (3 vezes ao dia e de 8 em 8
// horas sem número de doses). Confere a regra de integração (inclusão, alteração com trava de versão, idempotência,
// trilha, outbox e as recusas antes de gravar) e a grade de horários padrão (inclusão, alteração, inativação do horário
// que sai da grade sem apagar nada e a recusa pelo número de doses da frequência).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaFarmaciaPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F36PAR';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('parâmetros da integração prescrição × estoque (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFarmaciaPropria;
  let ctx: ContextoNucleo;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    unidade: 0,
    farmacia: 0,
    satelite: 0,
    alheio: 0,
    f3x: 0,
    f8h: 0,
  };
  let chave = 0;

  const limpar = async (e: Escritor) => {
    for (const t of [
      'idempotencia_operacao',
      'integracao_mensagem',
      'regra_integracao_prescricao',
      'horario_padrao_medicacao',
    ])
      await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN (?, ?)`, [ids.est, ids.outroEst]);
    await limparTrilhaDaMassa(e, { ids: [ids.est, ids.outroEst] });
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f36-par' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      await limpar(e);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f36par.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f36par.teste', 'USUARIO SINTETICO F36PAR', agora],
      );
      const ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'internacao', ?)",
        [ids.est, `${P}-UA`, 'UTI SINTETICA', agora],
      );
      ids.unidade = await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UTI`],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?, 'uti_adulto', ?)",
        [ids.est, ua, `${P}-UTI`, 'UTI SINTETICA F36PAR', agora],
      );
      const local = (estab: number, codigo: string, tipo: string) =>
        garantir(
          e,
          'SELECT id FROM local_estoque WHERE estabelecimento_id = ? AND codigo = ?',
          [estab, codigo],
          'INSERT INTO local_estoque (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?, ?)',
          [estab, codigo, `LOCAL ${codigo} SINTETICO`, tipo, agora],
        );
      ids.farmacia = await local(ids.est, `${P}-FC`, 'farmacia_central');
      ids.satelite = await local(ids.est, `${P}-FS`, 'farmacia_satelite');
      ids.alheio = await local(ids.outroEst, `${P}-FX`, 'farmacia_central');
      const freq = (codigo: string, tipo: string, intervalo: number | null, doses: number | null) =>
        garantir(
          e,
          'SELECT id FROM frequencia_administracao WHERE codigo = ?',
          [codigo],
          'INSERT INTO frequencia_administracao (codigo, descricao, tipo, intervalo_minutos, doses_por_dia, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [codigo, `FREQ ${codigo} SINTETICA`, tipo, intervalo, doses, agora],
        );
      ids.f3x = await freq(`${P}-3X`, 'vezes_ao_dia', null, 3);
      ids.f8h = await freq(`${P}-8H`, 'intervalo', 480, null);
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'teste-f36-par' };
    porta = new PortaFarmaciaPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f36-par' }, limpar);
    await nucleo.encerrar();
  });

  const op = (nome: string, entrada: unknown, k?: string) =>
    porta.executar(ctx, nome, entrada, {
      ...ctx,
      chaveIdempotencia: k ?? `f36par-${Date.now()}-${(chave += 1)}`,
    });
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f36-par' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))?.['n']);
  const outbox = (ponto: string) =>
    contar('SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = ? AND estabelecimento_id = ?', [
      ponto,
      ids.est,
    ]);
  const regras = () =>
    contar('SELECT COUNT(*) AS n FROM regra_integracao_prescricao WHERE estabelecimento_id = ?', [ids.est]);
  const regra = () => ({
    unidade: ids.unidade,
    localAtendente: ids.farmacia,
    localSubstituto: ids.satelite,
    tipoIntegracao: 'requisicao_automatica',
    momento: 'antes_do_horario',
    antecedenciaMinutos: 120,
    forma: 'dose_individualizada',
  });

  it('regra de integração: inclusão, alteração com versão, idempotência, trilha e outbox', async () => {
    const k = `f36par-inc-${Date.now()}`;
    const r = await op('suprimentos.gravarRegraIntegracao', regra(), k);
    const id = Number(r.resultado['regra']);
    expect(await ler('SELECT * FROM regra_integracao_prescricao WHERE id = ?', [id])).toMatchObject({
      estabelecimento_id: ids.est,
      unidade_internacao_id: ids.unidade,
      atendente_local_estoque_id: ids.farmacia,
      substituto_local_estoque_id: ids.satelite,
      momento_integracao: 'antes_do_horario',
      antecedencia_minutos: 120,
      prioridade: 100,
      versao: 1,
    });
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? AND estabelecimento_id = ?',
        ['regra_integracao_prescricao', id, ids.est],
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(await outbox('farmacia.regra_integracao.gravada')).toBe(1);
    // O mesmo pedido repetido não grava de novo.
    expect((await op('suprimentos.gravarRegraIntegracao', regra(), k)).repetida).toBe(true);
    expect(await regras()).toBe(1);
    // Alteração com a versão lida: muda a prioridade e a forma; a versão sobe.
    await op('suprimentos.gravarRegraIntegracao', {
      ...regra(),
      regra: id,
      versao: 1,
      prioridade: 50,
      forma: 'dose_unitaria',
    });
    expect(
      await ler(
        'SELECT prioridade, forma_dispensacao, versao FROM regra_integracao_prescricao WHERE id = ?',
        [id],
      ),
    ).toMatchObject({
      prioridade: 50,
      forma_dispensacao: 'dose_unitaria',
      versao: 2,
    });
    // A versão velha é recusada (outro usuário alterou antes).
    expect(
      codigoDe(
        await op('suprimentos.gravarRegraIntegracao', { ...regra(), regra: id, versao: 1 }).catch(
          (e: unknown) => e,
        ),
      ),
    ).toMatch(/versao|conflito/);
    // Inativar não apaga.
    await op('suprimentos.gravarRegraIntegracao', {
      ...regra(),
      regra: id,
      versao: 2,
      prioridade: 50,
      ativo: false,
    });
    expect(await regras()).toBe(1);
    const lidos = await porta.parametrosEditaveis(ctx);
    expect(lidos.regras.find((x) => x.regra === id)).toMatchObject({
      ativo: false,
      versao: 3,
      localAtendente: ids.farmacia,
    });
    expect(lidos.opcoes.locais.map((x) => x.id)).toEqual(
      expect.arrayContaining([ids.farmacia, ids.satelite]),
    );
    expect(lidos.opcoes.locais.map((x) => x.id)).not.toContain(ids.alheio);
  });

  it('regra de integração: recusas antes de gravar (nada gravado)', async () => {
    const antes = await regras();
    const recusa = async (e: unknown) =>
      codigoDe(await op('suprimentos.gravarRegraIntegracao', e).catch((x: unknown) => x));
    await op('suprimentos.gravarRegraIntegracao', { ...regra(), prioridade: 10 });
    const depois = antes + 1;
    expect(await recusa({ ...regra(), prioridade: 10 })).toBe('regra-duplicada');
    expect(await recusa({ ...regra(), unidade: null })).toBe('escopo-obrigatorio');
    expect(await recusa({ ...regra(), localSubstituto: ids.alheio })).toBe('referencia-inexistente');
    expect(await recusa({ ...regra(), localSubstituto: ids.farmacia })).toBe('mesmo-local');
    expect(await recusa({ ...regra(), momento: 'na_prescricao' })).toBe('antecedencia-sem-uso');
    expect(await regras()).toBe(depois);
  });

  it('horários padrão: inclusão, alteração, inativação sem apagar e recusa pelo número de doses', async () => {
    const grade = (frequencia: number, ...horas: string[]) => ({
      frequencia,
      setor: null,
      horarios: horas.map((hora) => ({ hora, dias: [] })),
    });
    const linhas = (f: number) =>
      contar(
        'SELECT COUNT(*) AS n FROM horario_padrao_medicacao WHERE estabelecimento_id = ? AND frequencia_administracao_id = ?',
        [ids.est, f],
      );
    const ativas = (f: number) =>
      contar(
        'SELECT COUNT(*) AS n FROM horario_padrao_medicacao WHERE estabelecimento_id = ? AND frequencia_administracao_id = ? AND ativo',
        [ids.est, f],
      );
    expect(
      (await op('suprimentos.gravarHorariosPadrao', grade(ids.f3x, '06:00', '14:00', '22:00'))).resultado,
    ).toMatchObject({
      incluidos: 3,
    });
    expect(
      await ler(
        "SELECT TIME_FORMAT(horario, '%H:%i') AS h FROM horario_padrao_medicacao WHERE estabelecimento_id = ? AND frequencia_administracao_id = ? AND ordem_dose = 3",
        [ids.est, ids.f3x],
      ),
    ).toMatchObject({ h: '22:00' });
    expect(await outbox('farmacia.horarios_padrao.gravados')).toBe(1);
    // A frequência de 3 doses por dia recusa a grade de 2 horários.
    expect(
      codigoDe(
        await op('suprimentos.gravarHorariosPadrao', grade(ids.f3x, '08:00', '20:00')).catch(
          (e: unknown) => e,
        ),
      ),
    ).toBe('doses-da-frequencia');
    // Mudar um horário altera só a linha dele.
    expect(
      (await op('suprimentos.gravarHorariosPadrao', grade(ids.f3x, '06:00', '14:00', '21:00'))).resultado,
    ).toMatchObject({
      incluidos: 0,
      alterados: 1,
      inativados: 0,
    });
    // Sem número de doses: a grade encolhe, o horário que sai fica inativo e nada é apagado.
    await op('suprimentos.gravarHorariosPadrao', grade(ids.f8h, '08:00', '16:00', '00:00'));
    expect(
      (await op('suprimentos.gravarHorariosPadrao', grade(ids.f8h, '08:00', '20:00'))).resultado,
    ).toMatchObject({
      alterados: 1,
      inativados: 1,
    });
    expect(await linhas(ids.f8h)).toBe(3);
    expect(await ativas(ids.f8h)).toBe(2);
    const g = (await porta.parametrosEditaveis(ctx)).grades.find((x) => x.frequencia === ids.f8h);
    expect(g?.horarios.map((h) => h.hora)).toEqual(['08:00', '20:00']);
  });
});
