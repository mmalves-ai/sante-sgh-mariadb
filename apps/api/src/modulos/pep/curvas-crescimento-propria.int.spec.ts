// Contrato de efeito das curvas de crescimento (03-PEP L141), contra o MariaDB real (cliente de teste f22_o3 por
// padrão, com as curvas carregadas por `python3 -I catalogos/carregar.py <cliente> curvas`). Massa SINTÉTICA própria
// (estabelecimento c2099, login teste.c2099.a, pacientes "PESSOA SINTETICA C2099 ..."), limpa antes e depois (a trilha
// pelo utilitário comum). Prova o que fica no banco: a medida de crescimento vira uma aferição fora do atendimento com
// autor e um valor por medida, com o nível de alerta pela curva da OMS (normal na mediana, crítico abaixo de -3, fora
// da faixa plausível no valor impossível para a idade); a leitura devolve o escore Z, o percentil, a classificação e o
// gráfico da curva com as linhas e os pontos do paciente; as recusas não gravam nada; e as rotas exigem o vínculo
// assistencial. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { CurvasCrescimentoController } from './curvas-crescimento.controller.js';
import { CurvasCrescimentoPropria } from './curvas-crescimento-propria.js';
import { EstadoProntuario } from './sessao-prontuario.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c2099';
const AUTOR = 'teste.c2099.a';
const AGORA = new Date('2026-11-25T12:00:00Z');
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('curvas de crescimento (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let curvas: CurvasCrescimentoPropria;
  const ids = {
    est: 0,
    autor: 0,
    prof: 0,
    paciente: 0,
    semNascimento: 0,
    prematuro: 0,
    mae: 0,
    atendimentoMae: 0,
  };
  // Prematuro sintético: 30 semanas, nascido em 01/02/2026; peso, comprimento e PC do nascimento na mediana (Z0) da
  // curva INTERGROWTH carregada em 30 semanas de idade pós-menstrual.
  const NASCIDO_PREMATURO = new Date('2026-02-01T12:00:00Z');
  const z0 = { peso: 0, estatura: 0, pc: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    for (const p of [ids.paciente, ids.semNascimento, ids.prematuro].filter(Boolean)) {
      await e.executar(
        `DELETE v FROM afericao_valor v JOIN afericao a ON a.id = v.afericao_id
          WHERE a.paciente_id = ? AND v.retifica_afericao_valor_id IS NOT NULL`,
        [p],
      );
      await e.executar(
        'DELETE v FROM afericao_valor v JOIN afericao a ON a.id = v.afericao_id WHERE a.paciente_id = ?',
        [p],
      );
      await e.executar('DELETE FROM afericao WHERE paciente_id = ?', [p]);
    }
    if (ids.est) {
      await e.executar('DELETE FROM registro_nascimento WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
      await limparTrilhaDaMassa(e, { codigos: [EST] });
    }
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2099' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctx = () => ({
    hospital: EST,
    login: AUTOR,
    correlacao: 'teste-c2099',
    chaveIdempotencia: `c2099-${randomUUID()}`,
  });
  const registrar = (e: Record<string, unknown>) => curvas.registrarMedida(ctx(), e);
  const contar = async (paciente: number) =>
    Number(
      (
        await ler<{ n: number }>(
          'SELECT COUNT(*) AS n FROM afericao_valor v JOIN afericao a ON a.id = v.afericao_id WHERE a.paciente_id = ?',
          [paciente],
        )
      )[0]!.n,
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    curvas = new CurvasCrescimentoPropria(nucleo, CLIENTE, () => AGORA);
    const carregadas = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM curva_referencia WHERE codigo_curva LIKE 'oms2006\\_%'",
      [],
    );
    expect(Number(carregadas[0]!.n), 'curvas da OMS carregadas no cliente de teste').toBe(8);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2099' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, 'Hospital sintético c2099', 'Hospital sintético c2099 (fictício)', agora],
      );
      ids.autor = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [AUTOR],
        'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
        [AUTOR, 'Conta sintética c2099', '20990990001', agora],
      );
      const pessoa = (nome: string, nascimento: string | null, sexo: number | null) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, data_nascimento, sexo_id, criado_em) VALUES (?, ?, ?, ?)',
          [nome, nascimento, sexo, agora],
        );
      const masc = Number(
        (await e.uma<{ id: number }>("SELECT id FROM sexo WHERE codigo = 'masculino'", []))!.id,
      );
      const pfProf = await pessoa('PESSOA SINTETICA C2099 PEDIATRA', null, null);
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pfProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', 'massa c2099', ?)",
        [pfProf, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_profissional WHERE usuario_id = ? AND profissional_id = ?',
        [ids.autor, ids.prof],
        'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [ids.autor, ids.prof, '2026-01-01', agora],
      );
      const paciente = async (nome: string, nascimento: string | null, numero: number) => {
        const pf = await pessoa(nome, nascimento, masc);
        return garantir(
          e,
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [pf],
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [pf, numero, agora],
        );
      };
      ids.paciente = await paciente('PESSOA SINTETICA C2099 CRIANCA', '2026-05-25', 209_909_901);
      ids.semNascimento = await paciente('PESSOA SINTETICA C2099 SEM NASCIMENTO', null, 209_909_902);
      ids.prematuro = await paciente('PESSOA SINTETICA C2099 PREMATURO', '2026-02-01', 209_909_903);
      const fem = Number(
        (await e.uma<{ id: number }>("SELECT id FROM sexo WHERE codigo = 'feminino'", []))!.id,
      );
      const pfMae = await pessoa('PESSOA SINTETICA C2099 MAE', '1996-04-12', fem);
      ids.mae = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pfMae],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pfMae, 209_909_904, agora],
      );
      const categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        ['c2099-int'],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO C2099', 'internacao', ?)",
        ['c2099-int', agora],
      );
      const carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss ORDER BY id LIMIT 1',
        [],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('C9', 'CARATER C2099', 'teste', ?)",
        [agora],
      );
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        ['c2099-sus'],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'PAGADORA C2099', 'operadora', 'ativa', ?)",
        ['c2099-sus', agora],
      );
      const tipoParto = await garantir(
        e,
        'SELECT id FROM tipo_parto WHERE codigo = ?',
        ['c2099-normal'],
        "INSERT INTO tipo_parto (codigo, descricao, criado_em) VALUES (?, 'PARTO C2099', ?)",
        ['c2099-normal', agora],
      );
      await limpar(e);
      ids.atendimentoMae = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ids.est,
          'c2099-at1',
          ids.mae,
          categoria,
          carater,
          fonte,
          ids.prof,
          new Date('2026-01-31T20:00:00Z'),
          agora,
        ],
      );
      for (const [ind, chave] of [
        ['peso', 'peso'],
        ['estatura', 'estatura'],
        ['pc', 'pc'],
      ] as const) {
        const l = await e.uma<{ y: string }>(
          `SELECT p.valor_y AS y FROM curva_referencia c JOIN curva_referencia_ponto p ON p.curva_referencia_id = c.id
            WHERE c.codigo_curva = ? AND p.codigo_faixa = 'Z0' AND p.valor_x = 30`,
          [`intergrowth_${ind}_pma_m`],
        );
        expect(l, `mediana INTERGROWTH de ${ind} em 30 semanas carregada`).toBeTruthy();
        z0[chave] = Number(l!.y);
      }
      await e.inserir(
        `INSERT INTO registro_nascimento (estabelecimento_id, mae_paciente_id, mae_atendimento_id, recem_nascido_paciente_id,
           nascido_em, tipo_parto_id, sexo_id, idade_gestacional_semanas, idade_gestacional_dias, peso_gramas,
           comprimento_cm, perimetro_cefalico_cm, responsavel_profissional_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 30, 0, ?, ?, ?, ?, ?)`,
        [
          ids.est,
          ids.mae,
          ids.atendimentoMae,
          ids.prematuro,
          NASCIDO_PREMATURO,
          tipoParto,
          masc,
          Math.round(z0.peso * 1000),
          Math.round(z0.estatura * 100) / 100,
          Math.round(z0.pc * 100) / 100,
          ids.prof,
          agora,
        ],
      );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2099' }, (e) => limpar(e));
    await nucleo.encerrar?.();
  });

  it('a medida vira aferição fora do atendimento, com autor e o nível de alerta de cada valor pela curva', async () => {
    // Menino de 179 dias: medianas da OMS perto de 7,9 kg, 67,6 cm e 43,3 cm.
    const r = await registrar({
      paciente: ids.paciente,
      medidoEm: '2026-11-20T10:00:00-03:00',
      pesoKg: 7.9,
      estaturaCm: 67.6,
      perimetroCefalicoCm: 43.3,
      observacao: '  puericultura  ',
    });
    expect(r.resultado.valores).toBe(3);
    const [a] = await ler('SELECT * FROM afericao WHERE id = ?', [r.resultado.afericao]);
    expect(a).toMatchObject({
      paciente_id: ids.paciente,
      estabelecimento_id: ids.est,
      atendimento_id: null,
      profissional_id: ids.prof,
      fonte: 'manual',
      observacao: 'puericultura',
      criado_por: ids.autor,
    });
    expect(Boolean(Number(a!['finalizada']))).toBe(true);
    const v = await ler<{ codigo: string; valor_numerico: string; nivel_alerta: string; sequencia: number }>(
      `SELECT pv.codigo, v.valor_numerico, v.nivel_alerta, v.sequencia FROM afericao_valor v
         JOIN parametro_vital pv ON pv.id = v.parametro_vital_id WHERE v.afericao_id = ? ORDER BY v.sequencia`,
      [r.resultado.afericao],
    );
    expect(v.map((x) => [x.codigo, Number(x.valor_numerico), x.nivel_alerta])).toEqual([
      ['peso', 7.9, 'normal'],
      ['altura', 67.6, 'normal'],
      ['perimetro_cefalico', 43.3, 'normal'],
    ]);
  });

  it('peso muito baixo fica crítico e o impossível para a idade fica fora da faixa plausível', async () => {
    const baixo = await registrar({ paciente: ids.paciente, medidoEm: '2026-11-21T10:00:00Z', pesoKg: 5.2 });
    const absurdo = await registrar({ paciente: ids.paciente, medidoEm: '2026-11-22T10:00:00Z', pesoKg: 40 });
    const nivel = async (afericao: number) =>
      (
        await ler<{ n: string }>('SELECT nivel_alerta AS n FROM afericao_valor WHERE afericao_id = ?', [
          afericao,
        ])
      )[0]!.n;
    expect(await nivel(baixo.resultado.afericao)).toBe('critico');
    expect(await nivel(absurdo.resultado.afericao)).toBe('fora_faixa_plausivel');
  });

  it('a leitura traz Z, percentil, classificação e o gráfico com as linhas da OMS e os pontos do paciente', async () => {
    const d = await curvas.doPaciente({ hospital: EST, login: AUTOR }, ids.paciente);
    expect(d.paciente).toMatchObject({ sexo: 'masculino', igSemanas: null });
    expect(d.referenciaAtual).toMatchObject({ publicacao: 'oms2006', corrigida: false });
    expect(d.medidas).toHaveLength(3);
    const mediana = d.medidas.find((m) => m.estaturaCm === 67.6)!;
    expect(mediana.origem).toBe('afericao');
    expect(Math.abs(mediana.avaliacoes.peso!.z)).toBeLessThan(0.2);
    expect(mediana.avaliacoes.peso!.percentil).toBeGreaterThan(40);
    expect(mediana.avaliacoes.peso!.classificacao.codigo).toBe('peso_adequado');
    expect(mediana.avaliacoes.imc!.classificacao.codigo).toBe('eutrofia');
    expect(mediana.avaliacoes.perimetro_cefalico!.classificacao.nivel).toBe('adequado');
    const baixo = d.medidas.find((m) => m.pesoKg === 5.2)!;
    expect(baixo.avaliacoes.peso!.z).toBeLessThan(-3);
    expect(baixo.avaliacoes.peso!.classificacao.codigo).toBe('muito_baixo_peso');
    const peso = d.graficos.find((g) => g.indicador === 'peso' && g.publicacao === 'oms2006')!;
    expect(peso.codigo).toBe('oms2006_peso_idade_m');
    expect(peso.versaoFonte).toBe('oms-2006');
    expect(peso.linhas.length).toBeGreaterThan(60);
    expect(peso.linhas[0]!.valores.map((x) => x.toFixed(1))).toEqual(['2.1', '2.5', '3.3', '4.4', '5.0']);
    expect(peso.pontos).toHaveLength(3);
    expect(peso.pontos.map((p) => p.nivel).sort()).toEqual(['adequado', 'alerta', 'revisar']);
    expect(d.graficos.map((g) => g.indicador).sort()).toEqual([
      'estatura',
      'imc',
      'perimetro_cefalico',
      'peso',
    ]);
    expect(d.semCurvas).toBe(false);
  });

  it('as recusas não gravam nada', async () => {
    const antes = await contar(ids.paciente);
    await expect(
      registrar({ paciente: ids.paciente, medidoEm: '2026-11-20T10:00:00Z' }),
    ).rejects.toMatchObject(recusada('medida-vazia'));
    await expect(
      registrar({ paciente: ids.paciente, medidoEm: '2026-12-20T10:00:00Z', pesoKg: 8 }),
    ).rejects.toMatchObject(recusada('medida-no-futuro'));
    await expect(
      registrar({ paciente: ids.paciente, medidoEm: '2026-11-20T10:00:00Z', pesoKg: 7900 }),
    ).rejects.toMatchObject(recusada('peso-impossivel'));
    await expect(
      registrar({ paciente: ids.paciente, medidoEm: '2026-01-20T10:00:00Z', pesoKg: 3 }),
    ).rejects.toMatchObject(recusada('medida-antes-do-nascimento'));
    await expect(
      registrar({ paciente: ids.semNascimento, medidoEm: '2026-11-20T10:00:00Z', pesoKg: 8 }),
    ).rejects.toMatchObject(recusada('sem-data-nascimento'));
    await expect(
      registrar({
        paciente: ids.paciente,
        atendimento: 999_999_999,
        medidoEm: '2026-11-20T10:00:00Z',
        pesoKg: 8,
      }),
    ).rejects.toMatchObject(recusada('atendimento-de-outro-paciente'));
    expect(await contar(ids.paciente)).toBe(antes);
    expect(await contar(ids.semNascimento)).toBe(0);
    const semNasc = await curvas.doPaciente({ hospital: EST, login: AUTOR }, ids.semNascimento);
    expect(semNasc).toMatchObject({ referenciaAtual: null, medidas: [], graficos: [] });
  });

  it('as rotas exigem o vínculo assistencial com o paciente e a leitura vai à trilha', async () => {
    const PERMS = ['pep.prontuario.ler', 'pep.evolucao.criar'];
    const montar = (vinculo: boolean) => {
      const trilha = new RegistradorTrilhaMemoria();
      const ctrl = new CurvasCrescimentoController(
        new EstadoProntuario(),
        trilha,
        curvas,
        null,
        null,
        new VinculoSintetico(
          vinculo ? [{ login: AUTOR, idPaciente: ids.paciente, forma: 'atendimento-em-curso' }] : [],
        ),
        null,
      );
      const req = () =>
        ({
          headers: { 'idempotency-key': `c2099-ctrl-${randomUUID()}`, 'x-correlation-id': 'c2099-ctrl' },
          ip: '127.0.0.1',
          sgh: {
            real: false,
            ability: criarAbility(regrasDeAcesso([...PERMS], null)),
            sessao: {
              usuario: { id: String(ids.autor), nome: 'Conta sintética', login: AUTOR },
              rede: 'rede-c2099',
              estabelecimentos: [],
              estabelecimentoAtivo: EST,
              unidadeAtiva: null,
              permissoes: [...PERMS],
              restricaoVinculo: true,
              sintetica: true,
              bloqueioInatividadeSegundos: 0,
              expiraEm: '',
            },
          },
        }) as unknown as RequisicaoAutorizada;
      return { trilha, ctrl, req };
    };
    const antes = await contar(ids.paciente);
    const sem = montar(false);
    await expect(sem.ctrl.doPaciente(ids.paciente, sem.req())).rejects.toMatchObject({ status: 403 });
    await expect(
      sem.ctrl.registrar({ paciente: ids.paciente, medidoEm: '2026-11-20T10:00:00Z', pesoKg: 8 }, sem.req()),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      sem.trilha.eventos.some(
        (e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.paciente === ids.paciente,
      ),
    ).toBe(true);
    expect(await contar(ids.paciente)).toBe(antes);
    const com = montar(true);
    const d = await com.ctrl.doPaciente(ids.paciente, com.req());
    expect(d.medidas.length).toBeGreaterThan(0);
    expect(
      com.trilha.eventos.filter(
        (e) =>
          e.evento === EVENTOS_AUDITAVEIS.consultaRes.codigo &&
          e.paciente === ids.paciente &&
          e.recurso === 'pep.prontuario',
      ),
    ).toHaveLength(1);
    const r = await com.ctrl.registrar(
      { paciente: ids.paciente, medidoEm: '2026-11-24T10:00:00Z', estaturaCm: 68 },
      com.req(),
    );
    expect(r.ok).toBe(true);
    expect(await contar(ids.paciente)).toBe(antes + 1);
    await expect(com.ctrl.doPaciente(999_999_999, com.req())).rejects.toMatchObject({ status: 404 });
  });

  it('prematuro: o nascimento entra como ponto na curva INTERGROWTH do banco, a OMS vem corrigida e o valor retificado sai', async () => {
    // 40 semanas de idade pós-menstrual (70 dias de vida): INTERGROWTH; o peso digitado errado é retificado.
    const termo = await registrar({ paciente: ids.prematuro, medidoEm: '2026-04-12T12:00:00Z', pesoKg: 2.4 });
    const original = (
      await ler<{ id: number }>('SELECT id FROM afericao_valor WHERE afericao_id = ?', [
        termo.resultado.afericao,
      ])
    )[0]!.id;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'retifica-c2099' }, (e) =>
      e.inserir(
        `INSERT INTO afericao_valor (afericao_id, sequencia, parametro_vital_id, valor_numerico, retifica_afericao_valor_id,
           motivo_retificacao, criado_em, criado_por)
         SELECT afericao_id, sequencia + 1, parametro_vital_id, 2.9, id, 'peso digitado errado', ?, ? FROM afericao_valor
          WHERE id = ?`,
        [new Date(), ids.autor, original],
      ),
    );
    // 292 dias de vida: 72 semanas pós-menstruais, idade corrigida de 7,3 meses na OMS 2006.
    await registrar({ paciente: ids.prematuro, medidoEm: '2026-11-20T12:00:00Z', pesoKg: 7.5 });

    const d = await curvas.doPaciente({ hospital: EST, login: AUTOR }, ids.prematuro);
    expect(d.paciente).toMatchObject({ sexo: 'masculino', igSemanas: 30, igDias: 0 });
    expect(d.referenciaAtual).toMatchObject({ publicacao: 'oms2006', corrigida: true });
    expect(d.medidas).toHaveLength(3);

    const nasc = d.medidas.find((m) => m.origem === 'nascimento')!;
    expect(nasc).toMatchObject({
      afericao: null,
      pesoKg: Math.round(z0.peso * 1000) / 1000,
      estaturaCm: Math.round(z0.estatura * 100) / 100,
      perimetroCefalicoCm: Math.round(z0.pc * 100) / 100,
    });
    expect(nasc.referencia).toMatchObject({ publicacao: 'intergrowth' });
    expect(nasc.referencia!.x).toBeCloseTo(30, 3);
    for (const ind of ['peso', 'estatura', 'perimetro_cefalico'] as const)
      expect(Math.abs(nasc.avaliacoes[ind]!.z), `Z do ${ind} pela linha Z0 carregada`).toBeLessThan(0.05);

    const aos40 = d.medidas.find((m) => m.afericao === termo.resultado.afericao)!;
    expect(aos40.pesoKg).toBe(2.9);
    expect(d.medidas.some((m) => m.pesoKg === 2.4)).toBe(false);
    expect(aos40.referencia).toMatchObject({ publicacao: 'intergrowth' });
    expect(aos40.referencia!.x).toBeCloseTo(40, 3);

    const corrigida = d.medidas.find((m) => m.pesoKg === 7.5)!;
    expect(corrigida.referencia).toMatchObject({ publicacao: 'oms2006', corrigida: true });
    expect(corrigida.referencia!.x).toBeCloseTo((292 - 70) / 30.4375, 2);
    expect(corrigida.avaliacoes.peso!.classificacao.codigo).toBe('peso_adequado');

    const ig = d.graficos.find((g) => g.indicador === 'peso' && g.publicacao === 'intergrowth')!;
    expect(ig.codigo).toBe('intergrowth_peso_pma_m');
    expect(ig.pontos.map((p) => p.x)).toEqual([30, 40]);
    expect(ig.linhas.length).toBeGreaterThan(10);
    expect(ig.linhas.every((l) => l.valores.length === 5 && l.x >= 27 && l.x <= 64)).toBe(true);
    const em30 = ig.linhas.find((l) => l.x === 30)!;
    expect(em30.valores[2]).toBeCloseTo(z0.peso, 6);
    expect(
      d.graficos
        .filter((g) => g.publicacao === 'intergrowth')
        .map((g) => g.indicador)
        .sort(),
    ).toEqual(['estatura', 'perimetro_cefalico', 'peso']);
    expect(d.graficos.find((g) => g.indicador === 'peso' && g.publicacao === 'oms2006')!.pontos).toHaveLength(
      1,
    );
  });
});
