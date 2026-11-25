// Contrato de efeito dos laudos específicos e das sessões da APAC (F7, 06-SUS linha 56) contra o MariaDB real (cliente
// de teste). Massa SINTÉTICA (estabelecimento com o código do teste, pacientes, médica, procedimentos e listas
// fictícias; removidos na limpeza). Prova o que fica no banco: o laudo de oncologia, saúde auditiva, medicamento e
// odontologia gravado na sequência 1 com o tipo do laudo trocado para a família; a correção que altera a mesma linha;
// a retirada que só marca como excluído e a volta na sequência seguinte; as recusas (versão vista, família errada,
// regra do domínio) sem gravar; a sessão na APAC autorizada, que abre a APAC da competência (inicial e depois
// continuidade ligada à anterior) e a competência de APAC; as recusas da sessão (futura, APAC não autorizada); o
// cancelamento que marca como excluída e a recusa na APAC já apresentada; a trilha de cada gravação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaApacComplementosPropria } from './apac-complementos-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2117apac';
// Códigos fictícios em cada família (o subgrupo decide a família; o 999 no fim não existe na tabela oficial).
const SIG = {
  onco: '0304029990',
  nefro: '0305019990',
  auditiva: '0701039990',
  medicamento: '0604019990',
  odonto: '0307049990',
} as const;
const GRUPOS = ['oncologia_quimioterapia', 'saude_auditiva', 'medicamento', 'odontologia', 'outro'];

describe.skipIf(SEM_BANCO)('PortaApacComplementosPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaApacComplementosPropria;
  let usuario = 0;
  let est = 0;
  const laudo: Record<keyof typeof SIG, number> = {
    onco: 0,
    nefro: 0,
    auditiva: 0,
    medicamento: 0,
    odonto: 0,
  };
  let dom = 0;
  const criados: { tabela: string; id: number }[] = [];
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const versao = async (id: number) =>
    Number((await ler<{ versao: number }>('SELECT versao FROM laudo_apac WHERE id = ?', [id]))[0]?.versao);

  async function limpar(e: Escritor): Promise<void> {
    const ests = 'SELECT id FROM estabelecimento WHERE codigo = ?';
    await e.executar(
      `DELETE s FROM apac_sessao s JOIN apac a ON a.id = s.apac_id WHERE a.estabelecimento_id IN (${ests})`,
      [P],
    );
    await e.executar(`UPDATE apac SET anterior_apac_id = NULL WHERE estabelecimento_id IN (${ests})`, [P]);
    await e.executar(`DELETE FROM apac WHERE estabelecimento_id IN (${ests})`, [P]);
    for (const t of [
      'laudo_apac_oncologia',
      'laudo_apac_auditiva',
      'laudo_apac_medicamento',
      'laudo_apac_odontologia',
    ])
      await e.executar(
        `DELETE x FROM ${t} x JOIN laudo_apac l ON l.id = x.laudo_apac_id WHERE l.estabelecimento_id IN (${ests})`,
        [P],
      );
    await e.executar(`DELETE FROM autorizacao_apac WHERE estabelecimento_id IN (${ests})`, [P]);
    await e.executar(`DELETE FROM laudo_apac WHERE estabelecimento_id IN (${ests})`, [P]);
    await e.executar(`DELETE FROM competencia_sus WHERE estabelecimento_id IN (${ests})`, [P]);
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaApacComplementosPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const garantir = async (tabela: string, sel: string, sp: unknown[], ins: string, ip: unknown[]) => {
        const x = await e.uma<{ id: number }>(sel, sp);
        if (x) return Number(x.id);
        const id = await e.inserir(ins, ip);
        criados.push({ tabela, id });
        return id;
      };
      const u = await e.uma('SELECT id FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 1');
      usuario = Number(u?.['id']);
      est = await e.inserir(
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, ?, ?)',
        [P, 'Hospital fictício C2117', 'Hospital fictício C2117 (teste)', '9021170', agora],
      );
      const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        'Paciente fictício C2117',
        agora,
      ]);
      criados.push({ tabela: 'pessoa_fisica', id: pf });
      const paciente = await e.inserir(
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 921170, 'ativo', ?)",
        [pf, agora],
      );
      criados.push({ tabela: 'paciente', id: paciente });
      const pfMed = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        'Médica fictícia C2117',
        agora,
      ]);
      criados.push({ tabela: 'pessoa_fisica', id: pfMed });
      const medico = await e.inserir(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'corpo_clinico', 'teste', ?)",
        [pfMed, agora],
      );
      criados.push({ tabela: 'profissional', id: medico });
      for (const g of GRUPOS)
        await garantir(
          'tipo_laudo_apac',
          'SELECT id FROM tipo_laudo_apac WHERE grupo_laudo = ? AND ativo = TRUE ORDER BY id LIMIT 1',
          [g],
          'INSERT INTO tipo_laudo_apac (codigo, descricao, grupo_laudo, criado_em) VALUES (?, ?, ?, ?)',
          [`C2117-${g}`.slice(0, 30), `Tipo fictício ${g}`, g, agora],
        );
      const outro = await e.uma(
        "SELECT id FROM tipo_laudo_apac WHERE grupo_laudo = 'outro' AND ativo = TRUE LIMIT 1",
      );
      dom = await garantir(
        'dominio_sus',
        "SELECT id FROM dominio_sus WHERE lista = 'finalidade_tratamento' AND codigo = 'C2117'",
        [],
        "INSERT INTO dominio_sus (lista, codigo, descricao, criado_em) VALUES ('finalidade_tratamento', 'C2117', 'Valor fictício', ?)",
        [agora],
      );
      let n = 0;
      for (const [k, codigo] of Object.entries(SIG) as [keyof typeof SIG, string][]) {
        const sig = await garantir(
          'procedimento_sigtap',
          'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?',
          [codigo],
          `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, sexo, vigencia_inicio, versao_fonte, criado_em)
           VALUES (?, 'Procedimento fictício C2117 (teste)', 1, 'ambos', '2008-01-01', 'teste', ?)`,
          [codigo, agora],
        );
        n += 1;
        laudo[k] = await e.inserir(
          `INSERT INTO laudo_apac (estabelecimento_id, numero_laudo, paciente_id, tipo_laudo_apac_id, data_laudo,
             solicitado_procedimento_sigtap_id, quantidade_solicitada, codigo_cid10_principal, solicitante_profissional_id,
             justificativa, situacao, criado_em) VALUES (?, ?, ?, ?, '2026-09-20', ?, 1, 'C509', ?, 'Justificativa fictícia', ?, ?)`,
          [
            est,
            `C2117${n}`,
            paciente,
            Number(outro?.['id']),
            sig,
            medico,
            k === 'nefro' ? 'autorizado' : 'solicitado',
            agora,
          ],
        );
        await e.inserir(
          `INSERT INTO autorizacao_apac (estabelecimento_id, laudo_apac_id, data_solicitacao, codigo_cid10, situacao,
             numero_apac, data_autorizacao, validade_inicio, validade_fim, tipo_apac, criado_em)
           VALUES (?, ?, '2026-09-20', 'C509', ?, ?, ?, ?, ?, ?, ?)`,
          k === 'nefro'
            ? [
                est,
                laudo[k],
                'autorizada',
                '9211700000017',
                '2026-09-25',
                '2026-10-01',
                '2026-12-31',
                'inicial',
                agora,
              ]
            : [est, laudo[k], 'solicitada', null, null, null, null, null, agora],
        );
      }
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, async (e) => {
      await limpar(e);
      for (const c of [...criados].reverse())
        await e.executar(`DELETE FROM ${c.tabela} WHERE id = ?`, [c.id]);
    });
    await nucleo.encerrar?.();
  });

  const onco = (extra: Record<string, unknown> = {}) => ({
    tipoTratamento: 'quimioterapia',
    dataDiagnostico: '2026-09-01',
    dataInicioTratamento: '2026-09-15',
    finalidade: dom,
    esquema: dom,
    estadiamentoTnm: 'T2N0M0',
    ...extra,
  });

  it('lê a pendência do laudo exigido pelo procedimento', async () => {
    const x = await porta.complementos(ctx(), laudo.onco);
    expect(x.exigido).toBe('oncologia');
    expect(x.pendente).toBe(true);
    expect(x.laudos.oncologia).toBeNull();
    expect(x.opcoes['finalidade_tratamento']?.some((o) => o.id === dom)).toBe(true);
    expect((await porta.complementos(ctx(), laudo.nefro)).exigido).toBe('nefrologia');
  });

  it('oncologia: grava na sequência 1, troca o tipo do laudo, corrige a mesma linha, retira sem apagar e volta na 2', async () => {
    const v0 = await versao(laudo.onco);
    // Versão vista errada e família errada: nada gravado.
    await expect(
      porta.gravarLaudo(ctx(), laudo.onco, 'oncologia', { versao: v0 + 5, dados: onco() }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(
      porta.gravarLaudo(ctx(), laudo.onco, 'auditiva', { versao: v0, dados: { causas: ['presbiacusia'] } }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.gravarLaudo(ctx(), laudo.onco, 'oncologia', { versao: v0, dados: onco({ esquema: null }) }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(
      await ler('SELECT id FROM laudo_apac_oncologia WHERE laudo_apac_id = ?', [laudo.onco]),
    ).toHaveLength(0);

    await porta.gravarLaudo(ctx(), laudo.onco, 'oncologia', { versao: v0, dados: onco() });
    let linhas = await ler(
      `SELECT o.sequencia, o.tipo_tratamento, o.estadiamento_tnm, o.versao, o.excluido_em, t.grupo_laudo
         FROM laudo_apac_oncologia o JOIN laudo_apac l ON l.id = o.laudo_apac_id
         JOIN tipo_laudo_apac t ON t.id = l.tipo_laudo_apac_id WHERE o.laudo_apac_id = ? ORDER BY o.sequencia`,
      [laudo.onco],
    );
    expect(linhas).toMatchObject([
      {
        sequencia: 1,
        tipo_tratamento: 'quimioterapia',
        estadiamento_tnm: 'T2N0M0',
        grupo_laudo: 'oncologia_quimioterapia',
      },
    ]);
    expect(await versao(laudo.onco)).toBe(v0 + 1);

    await porta.gravarLaudo(ctx(), laudo.onco, 'oncologia', {
      versao: v0 + 1,
      dados: onco({ estadiamentoTnm: 'T3N1M0' }),
    });
    linhas = await ler(
      'SELECT sequencia, estadiamento_tnm, versao FROM laudo_apac_oncologia WHERE laudo_apac_id = ?',
      [laudo.onco],
    );
    expect(linhas).toMatchObject([{ sequencia: 1, estadiamento_tnm: 'T3N1M0', versao: 2 }]);

    await porta.retirarLaudo(ctx(), laudo.onco, 'oncologia', { versao: v0 + 2 });
    const lido = await porta.complementos(ctx(), laudo.onco);
    expect(lido.laudos.oncologia).toBeNull();
    expect(lido.pendente).toBe(true);
    await porta.gravarLaudo(ctx(), laudo.onco, 'oncologia', { versao: v0 + 3, dados: onco() });
    linhas = await ler(
      'SELECT sequencia, excluido_em IS NOT NULL AS excluido FROM laudo_apac_oncologia WHERE laudo_apac_id = ? ORDER BY sequencia',
      [laudo.onco],
    );
    expect(linhas.map((x) => [Number(x['sequencia']), Number(x['excluido'])])).toEqual([
      [1, 1],
      [2, 0],
    ]);
    expect((await porta.complementos(ctx(), laudo.onco)).pendente).toBe(false);
  });

  it('auditiva, medicamento e odontologia gravam as colunas do complemento', async () => {
    await porta.gravarLaudo(ctx(), laudo.auditiva, 'auditiva', {
      versao: await versao(laudo.auditiva),
      dados: {
        cidCausaBasica: 'H90.3',
        dificuldadeAuditiva: true,
        ouvidoDireito: true,
        causas: ['presbiacusia'],
      },
    });
    expect(
      await ler(
        'SELECT codigo_cid10_causa_basica AS c, presbiacusia AS p, meningite AS m FROM laudo_apac_auditiva WHERE laudo_apac_id = ?',
        [laudo.auditiva],
      ),
    ).toMatchObject([{ c: 'H903', p: 1, m: 0 }]);

    await porta.gravarLaudo(ctx(), laudo.medicamento, 'medicamento', {
      versao: await versao(laudo.medicamento),
      dados: {
        medicamento: SIG.medicamento,
        cidPrincipal: 'E23.0',
        pesoKg: 70,
        alturaCm: 170,
        quantidades: [30, 30, null],
        periodoInicio: '2026-10-01',
        periodoFim: '2026-11-30',
      },
    });
    const med = await ler<{ q1: string; c: string; sig: string }>(
      `SELECT m.quantidade_mes_1 AS q1, m.codigo_cid10_principal AS c, ps.codigo_sigtap AS sig
         FROM laudo_apac_medicamento m JOIN procedimento_sigtap ps ON ps.id = m.procedimento_sigtap_id
        WHERE m.laudo_apac_id = ?`,
      [laudo.medicamento],
    );
    expect(med.map((x) => [Number(x.q1), x.c, x.sig])).toEqual([[30, 'E230', SIG.medicamento]]);

    await expect(
      porta.gravarLaudo(ctx(), laudo.odonto, 'odontologia', {
        versao: await versao(laudo.odonto),
        dados: { marcas: ['implante_metalico'], quantidadeImplantes: 4, tratamentoProposto: 'implante' },
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await porta.gravarLaudo(ctx(), laudo.odonto, 'odontologia', {
      versao: await versao(laudo.odonto),
      dados: {
        marcas: ['implante_metalico', 'desdentado_parcial'],
        quantidadeImplantes: 2,
        tratamentoProposto: 'implante',
      },
    });
    expect(
      await ler(
        `SELECT o.implante_metalico AS i, o.desdentado_parcial AS d, o.quantidade_implantes AS q, t.grupo_laudo AS g
           FROM laudo_apac_odontologia o JOIN laudo_apac l ON l.id = o.laudo_apac_id
           JOIN tipo_laudo_apac t ON t.id = l.tipo_laudo_apac_id WHERE o.laudo_apac_id = ?`,
        [laudo.odonto],
      ),
    ).toMatchObject([{ i: 1, d: 1, q: 2, g: 'odontologia' }]);
  });

  it('sessão: abre a APAC da competência (inicial, depois continuidade), recusa futura e não autorizada, cancela sem apagar', async () => {
    const v = await versao(laudo.nefro);
    const s1 = await porta.registrarSessao(ctx(), laudo.nefro, {
      versao: v,
      data: '2026-10-15',
      modalidade: 'hemodialise',
    });
    await porta.registrarSessao(ctx(), laudo.nefro, {
      versao: v,
      data: '2026-10-17',
      modalidade: 'hemodialise',
    });
    await porta.registrarSessao(ctx(), laudo.nefro, {
      versao: v,
      data: '2026-11-10',
      modalidade: 'capd',
      kits: 30,
    });
    const apacs = await ler(
      `SELECT a.id, a.tipo_apac, a.anterior_apac_id, a.situacao, c.competencia, c.instrumento,
              (SELECT COUNT(*) FROM apac_sessao s WHERE s.apac_id = a.id) AS sessoes
         FROM apac a JOIN competencia_sus c ON c.id = a.competencia_sus_id WHERE a.estabelecimento_id = ? ORDER BY c.competencia`,
      [est],
    );
    expect(apacs).toMatchObject([
      {
        tipo_apac: 'inicial',
        anterior_apac_id: null,
        situacao: 'aberta',
        competencia: '202610',
        instrumento: 'apac',
        sessoes: 2,
      },
      { tipo_apac: 'continuidade', anterior_apac_id: apacs[0]?.['id'], competencia: '202611', sessoes: 1 },
    ]);
    // Na data futura, fora da validade e sem modalidade: nada gravado.
    await expect(
      porta.registrarSessao(ctx(), laudo.nefro, { versao: v, data: '2027-01-05', modalidade: 'hemodialise' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.registrarSessao(ctx(), laudo.nefro, { versao: v, data: '2026-10-20' }),
    ).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(
      porta.registrarSessao(ctx(), laudo.onco, { versao: await versao(laudo.onco), data: '2026-10-20' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(
      await ler(
        'SELECT s.id FROM apac_sessao s JOIN apac a ON a.id = s.apac_id WHERE a.estabelecimento_id = ?',
        [est],
      ),
    ).toHaveLength(3);

    const lida = await porta.complementos(ctx(), laudo.nefro);
    expect(lida.sessoes.map((s) => [s.data, s.competencia, s.modalidade])).toEqual([
      ['2026-10-15', '202610', 'hemodialise'],
      ['2026-10-17', '202610', 'hemodialise'],
      ['2026-11-10', '202611', 'capd'],
    ]);
    await porta.cancelarSessao(ctx(), s1.id, { versao: 1 });
    expect(
      await ler('SELECT excluido_em IS NOT NULL AS x, excluido_por AS por FROM apac_sessao WHERE id = ?', [
        s1.id,
      ]),
    ).toMatchObject([{ x: 1, por: usuario }]);
    expect((await porta.complementos(ctx(), laudo.nefro)).sessoes).toHaveLength(2);

    // A APAC já apresentada não aceita cancelar a sessão.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, (e) =>
      e.executar("UPDATE apac SET situacao = 'apresentada' WHERE id = ?", [Number(apacs[1]?.['id'])]),
    );
    const s3 = lida.sessoes[2]!;
    await expect(porta.cancelarSessao(ctx(), s3.id, { versao: s3.versao })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(
      porta.registrarSessao(ctx(), laudo.nefro, { versao: v, data: '2026-11-12', modalidade: 'hemodialise' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
  });

  it('cada gravação deixa a trilha na mesma transação', async () => {
    const t = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade IN ('laudo_apac_oncologia','laudo_apac_auditiva','laudo_apac_medicamento','laudo_apac_odontologia','apac_sessao')`,
      [est],
    );
    expect(Number(t[0]?.n)).toBeGreaterThanOrEqual(10);
  });
});
