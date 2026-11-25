// Contrato de efeito da central de regras de aviso clínico (F3.3, 03-PEP L133) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: um estabelecimento com o código do teste, o tipo de aviso e as regras com o prefixo do teste
// (removidos na limpeza); os usuários e o perfil são ids já existentes do cliente (só os ids; nenhum dado da linha é
// lido), ligados ao estabelecimento sintético por acesso e perfil sintéticos. Prova o que fica no banco:
//   - tipo de aviso gravado (código, categoria, prioridade), código repetido recusado sem gravar;
//   - regra no motor de alertas (cenário aviso_clinico, evento em condicao, canais em notifica_tela/notifica_email),
//     versão 1 em regra_alerta_versao e os destinatários do estabelecimento; a alteração gera a versão 2, inativa o
//     destinatário que saiu (nunca apagado) e inclui o novo; regra sem canal recusada sem gravar;
//   - emissão: um aviso_clinico por regra que cobre o evento (regra, prioridade do tipo, janela no crítico, origem),
//     destinatários por usuário e canal (sistema e, com e-mail, a cópia por e-mail), sem o autor do evento; a central
//     de avisos do destinatário mostra o aviso uma vez só; evento sem regra não grava nada; a trilha da operação; o
//     teste pela central sai marcado como teste;
//   - a regra restrita a um setor do evento não dispara para outro setor; os alvos por especialidade, categoria
//     profissional (pelo conselho da inscrição) e setor de lotação resolvidos no banco para um usuário sintético
//     ligado a um profissional existente (só o id) por vínculo e lotação sintéticos;
//   - setor, atendimento e paciente de outro estabelecimento recusados (regra e evento) sem gravar;
//   - caminho real: a quebra de vidro (RegistroEmergenciaPropria) passa pelas regras na mesma transação e avisa o
//     destinatário da regra, sem o autor.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaAvisosClinicosPropria } from '../acesso/avisos-clinicos-propria.js';
import { RegistroEmergenciaPropria } from '../acesso/emergencia.controller.js';
import { PortaRegrasAvisoClinicoPropria } from './avisos-clinicos-regras-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2050avr';
const P2 = 'c2050avs';
const MOTIVO = 'C2050-TESTE';
const U4 = 'c2050avr.u4';
const CATEGORIA = 'c2050cat';
const TIPO = 'c2050_vc';
const TIPO_SEM_REGRA = 'c2050_sr';
const EST = `(SELECT id FROM estabelecimento WHERE codigo IN ('${P}', '${P2}'))`;
const REGRAS = `(SELECT id FROM regra_alerta WHERE codigo LIKE 'c2050-%')`;

async function limpar(e: Escritor): Promise<void> {
  await e.executar(
    `DELETE d FROM aviso_clinico_destinatario d JOIN aviso_clinico a ON a.id = d.aviso_clinico_id
      WHERE a.estabelecimento_id IN ${EST}`,
  );
  await e.executar(`DELETE FROM aviso_clinico WHERE estabelecimento_id IN ${EST}`);
  await e.executar(`DELETE FROM regra_alerta_destinatario WHERE regra_alerta_id IN ${REGRAS}`);
  await e.executar(`DELETE FROM regra_alerta_versao WHERE regra_alerta_id IN ${REGRAS}`);
  await e.executar("DELETE FROM regra_alerta WHERE codigo LIKE 'c2050-%'");
  await e.executar("DELETE FROM tipo_aviso_clinico WHERE codigo LIKE 'c2050%'");
  await e.executar(
    `DELETE FROM integracao_mensagem WHERE estabelecimento_id IN ${EST} AND entidade = 'acesso_emergencial'`,
  );
  await e.executar(`DELETE FROM acesso_emergencial WHERE estabelecimento_id IN ${EST}`);
  await e.executar('DELETE FROM motivo_acesso_emergencial WHERE codigo = ?', [MOTIVO]);
  await e.executar(`DELETE FROM usuario_perfil WHERE estabelecimento_id IN ${EST}`);
  await e.executar(`DELETE FROM lotacao_profissional WHERE estabelecimento_id IN ${EST}`);
  // A especialidade sintética do profissional ligado ao usuário sintético (o cliente de teste não tem nenhuma).
  await e.executar(
    `DELETE pe FROM profissional_especialidade pe
       JOIN usuario_profissional up ON up.profissional_id = pe.profissional_id
       JOIN usuario u ON u.id = up.usuario_id AND u.login = ?
      WHERE pe.especialidade_medica_id = (SELECT MIN(id) FROM especialidade_medica WHERE ativo)`,
    [U4],
  );
  await e.executar(
    'DELETE FROM usuario_profissional WHERE usuario_id IN (SELECT id FROM usuario WHERE login = ?)',
    [U4],
  );
  await e.executar('DELETE FROM categoria_profissional WHERE codigo = ?', [CATEGORIA]);
  await e.executar(`DELETE FROM usuario_estabelecimento WHERE estabelecimento_id IN ${EST}`);
  await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN ${EST}`);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM usuario WHERE login = ?', [U4]);
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaRegrasAvisoClinicoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRegrasAvisoClinicoPropria;
  let m: {
    est: number;
    autor: number;
    u2: number;
    u3: number;
    u4: number;
    perfil: number;
    paciente: number;
    setorX: number;
    setorY: number;
    setorOutro: number;
    esp: number;
    cat: number;
    atendimentoOutro: number;
  };
  let regra = 0;
  const ctx = (usuario = m.autor) => ({ cliente: CLIENTE, hospital: P, usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const contar = async (sql: string, p: unknown[] = []) => Number((await ler(sql, p))[0]!['n']);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const us = await e.consultar(
        "SELECT id FROM usuario WHERE excluido_em IS NULL AND situacao = 'ativo' ORDER BY id LIMIT 3",
      );
      if (us.length < 3) throw new Error('O cliente de teste precisa de três usuários ativos.');
      const ref = await e.uma(
        `SELECT (SELECT MIN(id) FROM paciente) AS paciente,
                (SELECT MIN(id) FROM perfil_acesso WHERE excluido_em IS NULL AND estabelecimento_id IS NULL) AS perfil`,
      );
      if (!ref?.['paciente'] || !ref['perfil'])
        throw new Error('O cliente de teste precisa de paciente e perfil.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const [autor, u2, u3] = us.map((x) => Number(x['id'])) as [number, number, number];
      for (const u of [autor, u2, u3])
        await e.inserir(
          `INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, padrao, vigencia_inicio, criado_em)
           VALUES (?, ?, FALSE, '2020-01-01', ?)`,
          [u, est, agora],
        );
      const perfil = Number(ref['perfil']);
      await e.inserir(
        `INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2020-01-01', ?)`,
        [u3, perfil, est, agora],
      );
      // Um profissional existente (só o id) com inscrição ativa num conselho; a especialidade dele e a categoria do
      // conselho são sintéticas (o cliente de teste não as tem).
      const ic = await e.uma(
        `SELECT profissional_id AS p, conselho_classe_id AS cc FROM inscricao_conselho
          WHERE situacao = 'ativa' AND excluido_em IS NULL ORDER BY id LIMIT 1`,
      );
      const espRef = await e.uma('SELECT MIN(id) AS id FROM especialidade_medica WHERE ativo');
      if (!ic || !espRef?.['id'])
        throw new Error('O cliente de teste precisa de inscrição em conselho e especialidade.');
      const cat = await e.inserir(
        `INSERT INTO categoria_profissional (codigo, descricao, grupo, conselho_classe_id, criado_em)
         VALUES (?, 'Categoria sintética c2050', 'enfermagem', ?, ?)`,
        [CATEGORIA, ic['cc'], agora],
      );
      await e.inserir(
        `INSERT INTO profissional_especialidade (profissional_id, especialidade_medica_id, criado_em)
         VALUES (?, ?, ?)`,
        [ic['p'], espRef['id'], agora],
      );
      const prof = { p: ic['p'], esp: espRef['id'], cat };
      const outro = await e.uma('SELECT MIN(id) AS id FROM atendimento WHERE estabelecimento_id <> ?', [est]);
      const cbo = await e.uma('SELECT MIN(id) AS id FROM ocupacao_cbo');
      if (!outro?.['id'] || !cbo?.['id'])
        throw new Error('O cliente de teste precisa de atendimento e de ocupação.');
      const est2 = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P2, `Hospital sintético ${P2}`, `Hospital sintético ${P2} (fictício)`, agora],
      );
      const setor = (estab: number, codigo: string) =>
        e.inserir(
          `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em)
           VALUES (?, ?, ?, 'assistencial', ?)`,
          [estab, codigo, `Setor sintético ${codigo}`, agora],
        );
      const setorX = await setor(est, 'c2050x');
      const setorY = await setor(est, 'c2050y');
      const setorOutro = await setor(est2, 'c2050z');
      const u4 = await e.inserir(
        `INSERT INTO usuario (login, nome, email, dispensa_cpf, situacao, criado_em)
         VALUES (?, 'Usuário sintético c2050', 'c2050@exemplo.invalid', TRUE, 'ativo', ?)`,
        [U4, agora],
      );
      await e.inserir(
        `INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, padrao, vigencia_inicio, criado_em)
         VALUES (?, ?, FALSE, '2020-01-01', ?)`,
        [u4, est, agora],
      );
      await e.inserir(
        `INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em)
         VALUES (?, ?, '2020-01-01', ?)`,
        [u4, prof['p'], agora],
      );
      await e.inserir(
        `INSERT INTO lotacao_profissional (profissional_id, estabelecimento_id, ocupacao_cbo_id, setor_funcional_id,
                                           vigencia_inicio, criado_em)
         VALUES (?, ?, ?, ?, '2020-01-01', ?)`,
        [prof['p'], est, cbo['id'], setorX, agora],
      );
      await e.inserir(
        "INSERT INTO motivo_acesso_emergencial (codigo, descricao, criado_em) VALUES (?, 'Motivo sintético c2050', ?)",
        [MOTIVO, agora],
      );
      return {
        est,
        autor,
        u2,
        u3,
        u4,
        perfil,
        paciente: Number(ref['paciente']),
        setorX,
        setorY,
        setorOutro,
        esp: Number(prof['esp']),
        cat: Number(prof['cat']),
        atendimentoOutro: Number(outro['id']),
      };
    });
    porta = new PortaRegrasAvisoClinicoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  it('grava o tipo de aviso (evento clínico) e recusa o código repetido sem gravar', async () => {
    const t = await porta.gravarTipo(ctx(), {
      codigo: TIPO,
      descricao: 'Valor crítico sintético',
      categoria: 'valor_critico',
      prioridade: 'critica',
      enviaEmail: true,
      exigeCiencia: true,
    });
    await porta.gravarTipo(ctx(), { codigo: TIPO_SEM_REGRA, descricao: 'Sem regra', categoria: 'outro' });
    const [r] = await ler(
      'SELECT codigo, categoria, prioridade, envia_email, ativo FROM tipo_aviso_clinico WHERE id = ?',
      [t.id],
    );
    expect(r).toMatchObject({ codigo: TIPO, categoria: 'valor_critico', prioridade: 'critica' });
    await expect(
      porta.gravarTipo(ctx(), { codigo: TIPO, descricao: 'Outro', categoria: 'outro' }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(
      porta.gravarTipo(ctx(), { codigo: 'Inválido', descricao: 'x', categoria: 'outro' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await contar("SELECT COUNT(*) AS n FROM tipo_aviso_clinico WHERE codigo LIKE 'c2050%'")).toBe(2);
  });

  it('grava a regra no motor de alertas com versão e destinatários; a alteração inativa quem saiu', async () => {
    const base = {
      codigo: 'c2050-r1',
      nome: 'Valor crítico avisa a equipe',
      tipoAviso: TIPO,
      mensagem: 'Resultado com valor crítico: veja o prontuário',
      canais: ['sistema', 'email'],
      vigenciaInicio: '2026-01-01',
    };
    await expect(
      porta.gravarRegra(ctx(), { ...base, canais: [], alvos: [{ tipo: 'usuario', id: m.u2 }] }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await contar("SELECT COUNT(*) AS n FROM regra_alerta WHERE codigo LIKE 'c2050-%'")).toBe(0);
    const g = await porta.gravarRegra(ctx(), {
      ...base,
      alvos: [
        { tipo: 'usuario', id: m.u2 },
        { tipo: 'perfil', id: m.perfil },
      ],
    });
    regra = g.id;
    expect(g.numeroVersao).toBe(1);
    const [r] = await ler<Record<string, unknown>>(
      `SELECT r.estabelecimento_id, ca.codigo AS cenario, r.condicao, r.notifica_tela, r.notifica_email,
              r.numero_versao_vigente, r.ativo
         FROM regra_alerta r JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id WHERE r.id = ?`,
      [regra],
    );
    expect(Number(r!['estabelecimento_id'])).toBe(m.est);
    expect(r!['cenario']).toBe('aviso_clinico');
    const cond = typeof r!['condicao'] === 'string' ? JSON.parse(r!['condicao'] as string) : r!['condicao'];
    expect(cond).toMatchObject({ tipoAviso: TIPO, setorEvento: null, especialidadeEvento: null });
    expect(Number(r!['notifica_tela'])).toBe(1);
    expect(Number(r!['notifica_email'])).toBe(1);

    const r2 = await porta.gravarRegra(ctx(), {
      ...base,
      id: regra,
      versao: 1,
      motivo: 'Troca do perfil pelo autor',
      alvos: [
        { tipo: 'usuario', id: m.u2 },
        { tipo: 'usuario', id: m.autor },
      ],
    });
    expect(r2.numeroVersao).toBe(2);
    const dest = await ler<Record<string, unknown>>(
      `SELECT tipo_destinatario, destino_id, ativo, estabelecimento_id FROM regra_alerta_destinatario
        WHERE regra_alerta_id = ? ORDER BY id`,
      [regra],
    );
    expect(dest.map((d) => [d['tipo_destinatario'], Number(d['destino_id']), Number(d['ativo'])])).toEqual([
      ['usuario', m.u2, 1],
      ['perfil', m.perfil, 0],
      ['usuario', m.autor, 1],
    ]);
    expect(dest.every((d) => Number(d['estabelecimento_id']) === m.est)).toBe(true);
    const versoes = await ler<Record<string, unknown>>(
      'SELECT numero_versao, operacao, motivo_alteracao FROM regra_alerta_versao WHERE regra_alerta_id = ? ORDER BY numero_versao',
      [regra],
    );
    expect(versoes.map((v) => [Number(v['numero_versao']), v['operacao']])).toEqual([
      [1, 'inclusao'],
      [2, 'alteracao'],
    ]);
    const painel = await porta.painel(ctx());
    expect(painel.regras.find((x) => x.id === regra)).toMatchObject({
      tipoAviso: TIPO,
      canais: ['sistema', 'email'],
      alvos: [
        { tipo: 'usuario', id: m.u2 },
        { tipo: 'usuario', id: m.autor },
      ],
      numeroVersao: 2,
    });
    expect(painel.tipos.some((t) => t.codigo === TIPO)).toBe(true);
  });

  it('o evento gera o aviso da regra para os destinatários por canal, sem o autor; sem regra, nada', async () => {
    // O teste da regra pela central (o evento real passa pelo mesmo serviço; ver a quebra de vidro abaixo).
    const r = await porta.emitir(ctx(m.autor), {
      tipoAviso: TIPO,
      mensagem: 'Potássio sintético acima do limite',
    });
    expect(r.avisos).toHaveLength(1);
    const [a] = await ler<Record<string, unknown>>(
      `SELECT regra_alerta_id, paciente_id, titulo, mensagem, prioridade, exibe_janela, situacao, modulo_origem,
              entidade_origem, criado_por
         FROM aviso_clinico WHERE id = ?`,
      [r.avisos[0]],
    );
    expect(a).toMatchObject({
      titulo: 'Teste da regra: Valor crítico sintético',
      mensagem: 'Potássio sintético acima do limite',
      prioridade: 'critica',
      situacao: 'pendente',
      modulo_origem: 'pep.aviso_clinico.teste',
      entidade_origem: null,
      paciente_id: null,
    });
    expect(Number(a!['regra_alerta_id'])).toBe(regra);
    expect(Number(a!['exibe_janela'])).toBe(1);
    expect(Number(a!['criado_por'])).toBe(m.autor);
    const d = await ler<Record<string, unknown>>(
      `SELECT usuario_id, canal, situacao, sequencia FROM aviso_clinico_destinatario
        WHERE aviso_clinico_id = ? ORDER BY sequencia`,
      [r.avisos[0]],
    );
    expect(d.length).toBe(r.destinatarios);
    expect(d.some((x) => Number(x['usuario_id']) === m.autor)).toBe(false);
    expect(d.filter((x) => x['canal'] === 'sistema').map((x) => Number(x['usuario_id']))).toEqual([m.u2]);
    expect(d.filter((x) => x['canal'] === 'email').every((x) => Number(x['usuario_id']) === m.u2)).toBe(true);
    expect(d.every((x) => x['situacao'] === 'pendente')).toBe(true);
    // A central de avisos do destinatário mostra o aviso uma vez só (a cópia por e-mail não entra na caixa).
    const caixa = await new PortaAvisosClinicosPropria(nucleo, CLIENTE).listar(ctx(m.u2));
    expect(caixa.avisos.filter((x) => x.aviso === r.avisos[0])).toHaveLength(1);
    expect(
      await contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [m.est]),
    ).toBeGreaterThan(0);

    const antes = await contar(`SELECT COUNT(*) AS n FROM aviso_clinico WHERE estabelecimento_id = ?`, [
      m.est,
    ]);
    expect(await porta.emitir(ctx(m.autor), { tipoAviso: TIPO_SEM_REGRA })).toEqual({
      avisos: [],
      destinatarios: 0,
    });
    expect(
      await contar(`SELECT COUNT(*) AS n FROM aviso_clinico WHERE estabelecimento_id = ?`, [m.est]),
    ).toBe(antes);
    const painel = await porta.painel(ctx());
    expect(painel.recentes.find((x) => x.id === r.avisos[0])).toMatchObject({ regra, sistema: 1 });
  });
  const destinosDe = async (aviso: number) =>
    (
      await ler<Record<string, unknown>>(
        'SELECT usuario_id, canal FROM aviso_clinico_destinatario WHERE aviso_clinico_id = ? ORDER BY sequencia',
        [aviso],
      )
    ).map((x) => [Number(x['usuario_id']), String(x['canal'])] as const);

  it('a regra restrita a um setor não dispara para outro; alvos por especialidade, categoria e setor no banco', async () => {
    await porta.gravarTipo(ctx(), { codigo: 'c2050_st', descricao: 'Evento do setor', categoria: 'outro' });
    const base = {
      codigo: 'c2050-r2',
      nome: 'Evento no setor X',
      tipoAviso: 'c2050_st',
      setorEvento: m.setorX,
      mensagem: 'Evento sintético no setor',
      canais: ['sistema'],
      vigenciaInicio: '2026-01-01',
    };
    const r2 = await porta.gravarRegra(ctx(), { ...base, alvos: [{ tipo: 'especialidade', id: m.esp }] });
    const [cond] = await ler<Record<string, unknown>>('SELECT condicao FROM regra_alerta WHERE id = ?', [
      r2.id,
    ]);
    const c =
      typeof cond!['condicao'] === 'string' ? JSON.parse(cond!['condicao'] as string) : cond!['condicao'];
    expect(c).toMatchObject({ tipoAviso: 'c2050_st', setorEvento: m.setorX });

    // Evento de outro setor: a regra não cobre, nada gravado.
    expect(await porta.emitir(ctx(m.autor), { tipoAviso: 'c2050_st', setor: m.setorY })).toEqual({
      avisos: [],
      destinatarios: 0,
    });
    expect(await contar('SELECT COUNT(*) AS n FROM aviso_clinico WHERE regra_alerta_id = ?', [r2.id])).toBe(
      0,
    );

    // Setor da regra: alvo por especialidade (profissional_especialidade do vínculo vigente).
    const porEsp = await porta.emitir(ctx(m.autor), { tipoAviso: 'c2050_st', setor: m.setorX });
    expect(porEsp.avisos).toHaveLength(1);
    expect(await destinosDe(porEsp.avisos[0]!)).toContainEqual([m.u4, 'sistema']);

    // Alvo por categoria profissional (pelo conselho da inscrição ativa).
    await porta.gravarRegra(ctx(), {
      ...base,
      id: r2.id,
      versao: 1,
      alvos: [{ tipo: 'categoria_profissional', id: m.cat }],
    });
    const porCat = await porta.emitir(ctx(m.autor), { tipoAviso: 'c2050_st', setor: m.setorX });
    expect(porCat.avisos).toHaveLength(1);
    expect(await destinosDe(porCat.avisos[0]!)).toContainEqual([m.u4, 'sistema']);

    // Alvo por setor (lotação ativa no estabelecimento): só o profissional lotado no setor X.
    await porta.gravarRegra(ctx(), {
      ...base,
      id: r2.id,
      versao: 2,
      alvos: [{ tipo: 'setor', id: m.setorX }],
    });
    const porSetor = await porta.emitir(ctx(m.autor), { tipoAviso: 'c2050_st', setor: m.setorX });
    expect(await destinosDe(porSetor.avisos[0]!)).toEqual([[m.u4, 'sistema']]);
    const [av] = await ler<Record<string, unknown>>(
      'SELECT regra_alerta_id FROM aviso_clinico WHERE id = ?',
      [porSetor.avisos[0]],
    );
    expect(Number(av!['regra_alerta_id'])).toBe(r2.id);
  });

  it('setor, atendimento e paciente de outro estabelecimento são recusados sem gravar', async () => {
    const antes = await contar('SELECT COUNT(*) AS n FROM aviso_clinico WHERE estabelecimento_id = ?', [
      m.est,
    ]);
    await expect(
      porta.gravarRegra(ctx(), {
        codigo: 'c2050-r3',
        nome: 'Setor de outro hospital',
        tipoAviso: 'c2050_st',
        setorEvento: m.setorOutro,
        mensagem: 'x',
        canais: ['sistema'],
        alvos: [{ tipo: 'usuario', id: m.u2 }],
        vigenciaInicio: '2026-01-01',
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await contar("SELECT COUNT(*) AS n FROM regra_alerta WHERE codigo = 'c2050-r3'")).toBe(0);
    for (const evento of [
      { tipoAviso: 'c2050_st', setor: m.setorOutro },
      { tipoAviso: 'c2050_st', setor: m.setorX, atendimento: m.atendimentoOutro },
      { tipoAviso: 'c2050_st', setor: m.setorX, paciente: m.paciente },
    ])
      await expect(porta.emitir(ctx(m.autor), evento)).rejects.toMatchObject({ problema: { status: 422 } });
    expect(
      await contar('SELECT COUNT(*) AS n FROM aviso_clinico WHERE estabelecimento_id = ?', [m.est]),
    ).toBe(antes);
  });

  it('caminho real: a quebra de vidro passa pelas regras na mesma transação e avisa o destinatário, sem o autor', async () => {
    await porta.gravarTipo(ctx(), {
      codigo: 'c2050_ae',
      descricao: 'Acesso de emergência sintético',
      categoria: 'acesso_emergencia',
      prioridade: 'alta',
    });
    const regraAe = await porta.gravarRegra(ctx(), {
      codigo: 'c2050-r4',
      nome: 'Quebra de vidro avisa a auditoria',
      tipoAviso: 'c2050_ae',
      mensagem: 'Prontuário aberto em acesso de emergência: revise',
      canais: ['sistema'],
      alvos: [
        { tipo: 'usuario', id: m.u2 },
        { tipo: 'usuario', id: m.autor },
      ],
      vigenciaInicio: '2026-01-01',
    });
    const [conta] = await ler<Record<string, unknown>>('SELECT login FROM usuario WHERE id = ?', [m.autor]);
    const aberto = await new RegistroEmergenciaPropria(nucleo, CLIENTE).abrir({
      rede: CLIENTE,
      hospital: P,
      idUsuario: m.autor,
      login: String(conta!['login']),
      idPaciente: m.paciente,
      atendimento: null,
      motivo: MOTIVO,
      justificativa: 'Justificativa sintética do teste de integração',
      minutos: 30,
      estacao: 'teste:c2050',
      enderecoIp: null,
      correlacao: `${P}-emergencia`,
    });
    const avisos = await ler<Record<string, unknown>>(
      `SELECT id, regra_alerta_id, titulo, mensagem, prioridade, modulo_origem, paciente_id FROM aviso_clinico
        WHERE entidade_origem = 'acesso_emergencial' AND entidade_origem_chave = ? AND estabelecimento_id = ?`,
      [Number(aberto.id), m.est],
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      titulo: 'Acesso de emergência sintético',
      mensagem: 'Prontuário aberto em acesso de emergência: revise',
      prioridade: 'alta',
      modulo_origem: 'acesso.emergencia',
    });
    expect(Number(avisos[0]!['regra_alerta_id'])).toBe(regraAe.id);
    expect(Number(avisos[0]!['paciente_id'])).toBe(m.paciente);
    expect(await destinosDe(Number(avisos[0]!['id']))).toEqual([[m.u2, 'sistema']]);
  });
});
