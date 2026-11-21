// Integração da porta própria do portal do paciente (M50) contra o MariaDB real, cliente f22_o3 (onda 3), massa
// SINTÉTICA criada no beforeAll e apagada no afterAll (nenhum dado de pessoa real):
//   - o paciente do cadastro único (primeiro nome, nascimento, óbito, unificação, responsável legal vigente) pela PK e
//     pelo prontuário; as capacidades civis; os nomes dos usuários; os feriados nas quatro abrangências (nacional,
//     estadual pela UF do município do estabelecimento, municipal e do estabelecimento);
//   - contrato de efeito da manifestação pelo portal: a linha da ouvidoria (número de negócio, canal do portal, tipo,
//     motivo, prazo, situação aberta, versao 1), a trilha na tabela gravada de fato (não na que o serviço informa), o
//     assunto livre (pelo código, pela descrição ou no relato, nunca recusado) e a recusa do tipo desconhecido;
//   - o outro estabelecimento não vê a manifestação;
//   - a operação sem modelo recusa com 503 `recurso-sem-modelo` (nada lido vazio).
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAgendaOnlinePropria } from './agenda/porta-propria.js';
import type { ContextoPortal } from './porta.js';
import { PortaPortalPropria } from './porta-propria.js';
import type { RegistroTrilhaPortal } from './tipos.js';

const CLIENTE = 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'L0312P';
const OUTRO = 'L0312PX';
const PRONT = [931_201, 931_202, 931_203];
const TIPO = 'l0312_reclamacao';
const MOTIVO = 'l0312_atendimento';
const LOGIN = 'l0312p.recepcao';
const MUNICIPIO = '9931201';
const FERIADOS = ['L0312 NACIONAL', 'L0312 ESTADUAL', 'L0312 MUNICIPAL', 'L0312 OUTRA UF'];

interface Massa {
  readonly est: number;
  readonly outro: number;
  readonly pacientes: number[];
  readonly capacidade: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor, ests: readonly number[]): Promise<void> {
  const em = ests.map(() => '?').join(', ');
  const pr = PRONT.map(() => '?').join(', ');
  await e.executar(`DELETE FROM manifestacao_ouvidoria WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `DELETE FROM sequencia_negocio WHERE estabelecimento_id IN (${em}) AND tipo = 'manifestacao_ouvidoria'`,
    ests,
  );
  await e.executar(`DELETE FROM feriado WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM feriado WHERE nome IN (${FERIADOS.map(() => '?').join(', ')})`, FERIADOS);
  await e.executar(`UPDATE estabelecimento SET municipio_ibge_id = NULL WHERE id IN (${em})`, ests);
  await e.executar('DELETE FROM municipio_ibge WHERE codigo_ibge = ?', [MUNICIPIO]);
  await e.executar(
    `DELETE r FROM responsavel_paciente r JOIN paciente p ON p.id = r.paciente_id WHERE p.numero_prontuario IN (${pr})`,
    PRONT,
  );
  const pfs = await e.consultar(
    `SELECT pessoa_fisica_id AS id FROM paciente WHERE numero_prontuario IN (${pr})`,
    PRONT,
  );
  await e.executar(`DELETE FROM paciente WHERE numero_prontuario IN (${pr})`, PRONT);
  for (const x of pfs) await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [x['id']]);
}

describe.skipIf(SEM_BANCO)(`porta própria do portal do paciente (MariaDB, cliente ${CLIENTE})`, () => {
  const nucleo = new NucleoProprio();
  let m: Massa;
  let porta: PortaPortalPropria;
  const c: ContextoPortal = { rede: CLIENTE, hospital: EST };
  const cOutro: ContextoPortal = { rede: CLIENTE, hospital: OUTRO };
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l0312' }, (l) => l.consultar(sql, p)) as Promise<
      T[]
    >;

  beforeAll(async () => {
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-12' }, async (e) => {
      const agora = new Date();
      const estab = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, 'ESTAB SINTETICO PORTAL', 'ESTAB SINTETICO PORTAL', agora],
        );
      const est = await estab(EST);
      const outro = await estab(OUTRO);
      await limpar(e, [est, outro]);
      await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, 'USUARIO SINTETICO PORTAL', 'pessoa', TRUE, ?)",
        [LOGIN, agora],
      );
      const capacidade = await garantir(
        e,
        'SELECT id FROM capacidade_civil WHERE codigo = ?',
        ['l0312_plena'],
        "INSERT INTO capacidade_civil (codigo, descricao, exige_responsavel_legal, ativo, criado_em) VALUES ('l0312_plena', 'CAPACIDADE SINTETICA', FALSE, TRUE, ?)",
        [agora],
      );
      await garantir(
        e,
        'SELECT id FROM tipo_manifestacao_ouvidoria WHERE codigo = ?',
        [TIPO],
        "INSERT INTO tipo_manifestacao_ouvidoria (codigo, descricao, ativo, natureza, exige_resposta, permite_anonimo, criado_em) VALUES (?, 'RECLAMACAO SINTETICA', TRUE, 'reclamacao', TRUE, FALSE, ?)",
        [TIPO, agora],
      );
      await garantir(
        e,
        'SELECT id FROM canal_ouvidoria WHERE codigo = ?',
        ['portal'],
        "INSERT INTO canal_ouvidoria (codigo, descricao, ativo, tipo_canal, exige_contato, ordem, criado_em) VALUES ('portal', 'Portal do paciente', TRUE, 'site', FALSE, 90, ?)",
        [agora],
      );
      await garantir(
        e,
        'SELECT id FROM motivo_manifestacao WHERE codigo = ?',
        [MOTIVO],
        "INSERT INTO motivo_manifestacao (codigo, descricao, criado_em) VALUES (?, 'ATENDIMENTO SINTETICO', ?)",
        [MOTIVO, agora],
      );
      const nomes = ['MARIA SINTETICA TESTE', 'JOAO SINTETICO TESTE', 'ANA SINTETICA TESTE'];
      const pacientes: number[] = [];
      for (const [i, nome] of nomes.entries()) {
        const pf = await e.inserir(
          'INSERT INTO pessoa_fisica (nome, data_nascimento, falecida, criado_em) VALUES (?, ?, ?, ?)',
          [nome, i === 1 ? '2016-05-10' : '1990-07-01', i === 2, agora],
        );
        pacientes.push(
          await e.inserir(
            'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, capacidade_civil_id, falecido, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
            [pf, PRONT[i], i === 2 ? 'obito' : 'ativo', i === 0 ? capacidade : null, i === 2, agora],
          ),
        );
      }
      // A mãe (paciente 0) é a responsável legal vigente do filho (paciente 1).
      const pfMae = await e.uma<{ id: number }>('SELECT pessoa_fisica_id AS id FROM paciente WHERE id = ?', [
        pacientes[0],
      ]);
      await e.executar(
        "INSERT INTO responsavel_paciente (paciente_id, pessoa_fisica_id, papel, vigencia_inicio, criado_em) VALUES (?, ?, 'responsavel_legal', '2016-05-10', ?)",
        [pacientes[1], pfMae!.id, agora],
      );
      await e.executar(
        "INSERT INTO feriado (data, nome, abrangencia, estabelecimento_id, criado_em) VALUES ('2034-11-02', 'FERIADO SINTETICO', 'estabelecimento', ?, ?)",
        [est, agora],
      );
      await e.executar(
        "INSERT INTO feriado (data, nome, abrangencia, estabelecimento_id, criado_em) VALUES ('2034-11-03', 'FERIADO DO OUTRO', 'estabelecimento', ?, ?)",
        [outro, agora],
      );
      // A UF e o município do estabelecimento (sintético, sob uma UF do catálogo) para os feriados estadual e municipal.
      let uf = await e.uma<{ id: number; sigla: string }>(
        'SELECT id, sigla FROM unidade_federativa ORDER BY id LIMIT 1',
        [],
      );
      if (!uf) {
        const pais = await e.uma<{ id: number }>('SELECT id FROM pais_referencia ORDER BY id LIMIT 1', []);
        const id = await e.inserir(
          "INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES ('99', 'ZY', 'UF SINTETICA', ?, ?)",
          [pais!.id, agora],
        );
        uf = { id, sigla: 'ZY' };
      }
      const municipio = await e.inserir(
        "INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em) VALUES (?, 'MUNICIPIO SINTETICO L0312', ?, ?)",
        [MUNICIPIO, uf.id, agora],
      );
      await e.executar('UPDATE estabelecimento SET municipio_ibge_id = ? WHERE id = ?', [municipio, est]);
      const outraUf = uf.sigla === 'ZX' ? 'ZW' : 'ZX';
      for (const [dia, nome, abr, ufF, mun] of [
        ['2034-11-06', 'L0312 NACIONAL', 'nacional', null, null],
        ['2034-11-07', 'L0312 ESTADUAL', 'estadual', uf.sigla, null],
        ['2034-11-08', 'L0312 MUNICIPAL', 'municipal', null, municipio],
        ['2034-11-09', 'L0312 OUTRA UF', 'estadual', outraUf, null],
      ] as const)
        await e.executar(
          'INSERT INTO feriado (data, nome, abrangencia, uf, municipio_ibge_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [dia, nome, abr, ufF, mun, agora],
        );
      return { est, outro, pacientes, capacidade };
    });
    porta = new PortaPortalPropria(nucleo);
  }, 60_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-03-12' }, (e) =>
        limpar(e, [m.est, m.outro]),
      );
    await nucleo.encerrar();
  });

  it('paciente pela PK e pelo prontuário: primeiro nome, nascimento, óbito, guarda legal vigente; inexistente é null', async () => {
    const [mae, filho, falecida] = m.pacientes as [number, number, number];
    expect(await porta.paciente(c, mae)).toEqual({
      id: mae,
      prontuario: PRONT[0],
      nascimento: '1990-07-01',
      ativo: true,
      obito: false,
      unificadoEm: null,
      primeiroNome: 'MARIA',
      capacidadeCivil: m.capacidade,
      temGuardiao: false,
    });
    expect(await porta.paciente(c, filho)).toMatchObject({
      primeiroNome: 'JOAO',
      temGuardiao: true,
      nascimento: '2016-05-10',
    });
    expect(await porta.paciente(c, falecida)).toMatchObject({ ativo: false, obito: true });
    expect(await porta.paciente(c, 2_000_000_000)).toBeNull();
    expect((await porta.pacientesPorProntuario(c, PRONT[1]!)).map((p) => p.id)).toEqual([filho]);
    expect(await porta.guardiaoConfere(c, filho, mae)).toBe(true);
    expect(await porta.guardiaoConfere(c, mae, filho)).toBe(false);
  });

  it('capacidades civis, nomes dos usuários e feriados só do estabelecimento da sessão', async () => {
    expect((await porta.capacidadesCivis(c)).map((x) => x.id)).toContain(m.capacidade);
    expect((await porta.nomes(c, [LOGIN, 'inexistente.l0312'])).get(LOGIN)).toBe('USUARIO SINTETICO PORTAL');
    expect(await porta.nomes(c, [])).toEqual(new Map());
    const f = await porta.feriados(c, '2034-11-01', '2034-11-30');
    expect(f).toContainEqual({ data: '2034-11-02', nome: 'FERIADO SINTETICO' });
    expect(f.map((x) => x.nome)).not.toContain('FERIADO DO OUTRO');
    // As quatro abrangências: nacional, estadual (UF do município do estabelecimento) e municipal; a de outra UF não.
    expect(f.map((x) => x.nome)).toEqual(
      expect.arrayContaining(['L0312 NACIONAL', 'L0312 ESTADUAL', 'L0312 MUNICIPAL']),
    );
    expect(f.map((x) => x.nome)).not.toContain('L0312 OUTRA UF');
    // O outro estabelecimento (sem município) vê o nacional, mas não o estadual nem o municipal.
    const fo = (await porta.feriados(cOutro, '2034-11-01', '2034-11-30')).map((x) => x.nome);
    expect(fo).toContain('L0312 NACIONAL');
    expect(fo).not.toContain('L0312 ESTADUAL');
    expect(fo).not.toContain('L0312 MUNICIPAL');
  });

  it('manifestação pelo portal: linha na ouvidoria, número de negócio, trilha com o evento; outro estabelecimento não vê', async () => {
    const [mae] = m.pacientes as [number];
    const trilha = (r: { id: number; protocolo: string }): RegistroTrilhaPortal => ({
      rede: CLIENTE,
      hospital: EST,
      usuario: 'PORTAL',
      evento: 'portal.manifestacao.registrada',
      recurso: 'portal.manifestacao',
      operacao: 'inclusao',
      tabelaAlvo: 'conta_portal_paciente',
      idAlvo: String(r.id),
      chaveNaturalAlvo: r.protocolo,
      resultado: 'sucesso',
      estacao: null,
      correlacao: 'teste-l0312',
      idPaciente: mae,
    });
    const r = await porta.gravar(
      c,
      (g) =>
        g.registrarManifestacao({
          protocoloDe: (n) => `OUV-${n}`,
          tipo: TIPO,
          paciente: mae,
          area: MOTIVO,
          relato: 'relato sintético do teste',
          recebidaEm: '2034-11-01T10:00:00.000Z',
          prazoEm: '2034-11-25',
          usuario: 'PORTAL',
        }),
      trilha,
    );
    expect(r.protocolo).toMatch(/^OUV-\d+$/);
    const [linha] = await ler<Record<string, unknown>>(
      `SELECT m.numero, m.situacao, m.versao, m.identificada, m.paciente_id, co.codigo AS canal, t.codigo AS tipo, mm.codigo AS motivo
         FROM manifestacao_ouvidoria m JOIN canal_ouvidoria co ON co.id = m.canal_ouvidoria_id
         JOIN tipo_manifestacao_ouvidoria t ON t.id = m.tipo_manifestacao_ouvidoria_id
         LEFT JOIN motivo_manifestacao mm ON mm.id = m.motivo_manifestacao_id WHERE m.id = ?`,
      [r.id],
    );
    expect(linha).toMatchObject({
      numero: r.protocolo,
      situacao: 'aberta',
      versao: 1,
      paciente_id: mae,
      canal: 'portal',
      tipo: TIPO,
      motivo: MOTIVO,
    });
    const tr = await ler<Record<string, unknown>>(
      "SELECT motivo, estabelecimento_id FROM trilha_auditoria WHERE entidade = 'manifestacao_ouvidoria' AND entidade_id = ?",
      [r.id],
    );
    // A trilha aponta a tabela gravada de fato, mesmo com outra tabela informada pelo registro do serviço.
    expect(tr).toEqual([
      expect.objectContaining({ motivo: 'portal.manifestacao.registrada', estabelecimento_id: m.est }),
    ]);
    expect(
      await ler(
        "SELECT id FROM trilha_auditoria WHERE entidade = 'conta_portal_paciente' AND entidade_id = ?",
        [r.id],
      ),
    ).toEqual([]);
    const lidas = await porta.manifestacoes(c, mae);
    expect(lidas).toEqual([
      expect.objectContaining({
        id: r.id,
        protocolo: r.protocolo,
        tipo: TIPO,
        area: MOTIVO,
        situacao: 'aberta',
        prazoEm: '2034-11-25',
      }),
    ]);
    expect(await porta.manifestacoes(cOutro, mae)).toEqual([]);
    // Recusa: tipo fora do catálogo (nada gravado).
    await expect(
      porta.gravar(
        c,
        (g) =>
          g.registrarManifestacao({
            protocoloDe: (n) => `OUV-${n}`,
            tipo: 'l0312_inexistente',
            paciente: mae,
            area: '',
            relato: 'x',
            recebidaEm: '2034-11-01T10:00:00.000Z',
            prazoEm: '2034-11-25',
            usuario: 'PORTAL',
          }),
        null,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'tipo-invalido' } });
    expect((await porta.manifestacoes(c, mae)).length).toBe(1);
  });

  it('assunto da manifestação: pelo código, pela descrição ou, livre, no relato; sem assunto, sem motivo (nunca recusa)', async () => {
    const [, filho] = m.pacientes as [number, number];
    const registrar = (area: string) =>
      porta.gravar(
        c,
        (g) =>
          g.registrarManifestacao({
            protocoloDe: (n) => `OUV-${n}`,
            tipo: TIPO,
            paciente: filho,
            area,
            relato: 'relato sintético',
            recebidaEm: '2034-11-01T10:00:00.000Z',
            prazoEm: '2034-11-25',
            usuario: 'PORTAL',
          }),
        null,
      );
    const linha = async (id: number) =>
      (
        await ler<Record<string, unknown>>(
          'SELECT mm.codigo AS motivo, m.relato FROM manifestacao_ouvidoria m LEFT JOIN motivo_manifestacao mm ON mm.id = m.motivo_manifestacao_id WHERE m.id = ?',
          [id],
        )
      )[0];
    expect(await linha((await registrar('atendimento sintetico')).id)).toEqual({
      motivo: MOTIVO,
      relato: 'relato sintético',
    });
    expect(await linha((await registrar('Demora na recepção')).id)).toEqual({
      motivo: null,
      relato: 'Assunto informado: Demora na recepção\n\nrelato sintético',
    });
    expect(await linha((await registrar('')).id)).toEqual({ motivo: null, relato: 'relato sintético' });
  });

  it('sem modelo: conta, vínculos, consentimentos, pedidos, cópia e a etapa 2 recusam com 503 nomeando a operação', async () => {
    for (const p of [
      porta.conta(),
      porta.contaDoPaciente(),
      porta.vinculosDoTitular(),
      porta.consentimentos(),
      porta.pedidos(),
      porta.filaCopias(),
    ])
      await expect(p).rejects.toMatchObject({ problema: { status: 503, codigo: 'recurso-sem-modelo' } });
    await expect(porta.gravar(c, (g) => g.criarConta({} as never), null)).rejects.toMatchObject({
      problema: { codigo: 'recurso-sem-modelo' },
    });
    const agenda = new PortaAgendaOnlinePropria();
    await expect(agenda.configs()).rejects.toMatchObject({
      problema: { status: 503, codigo: 'recurso-sem-modelo' },
    });
    await expect(agenda.gravar()).rejects.toMatchObject({ problema: { codigo: 'recurso-sem-modelo' } });
  });
});
