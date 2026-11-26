// Contrato de efeito da pesquisa clínica (F8, 03-PEP linha 144) contra o MariaDB real (cliente de teste). Massa
// SINTÉTICA com o código "c3020pq": dois estabelecimentos fictícios, dois pacientes, um profissional, um atendimento por
// paciente, um termo CID sintético (Z99P1, inexistente na CID-10) no atendimento do paciente A, um tipo de anexo, um
// arquivo e um anexo do prontuário por paciente (nenhuma pessoa real); usuário, categoria, caráter, fonte pagadora,
// sexo e terminologia são ids já existentes do cliente de teste (só os ids são lidos).
// Prova o que fica no banco: o estudo com o investigador na equipe; a situação sem CAAE recusada sem escrita; o
// critério incoerente recusado; a triagem recusada com o estudo fora de recrutando e com a automática desligada sem
// pacientes; a triagem manual grava só o candidato que atende (idade e CID automáticos, o manual "a conferir"); o
// paciente com triagem aberta não repete; a inclusão sem TCLE e com anexo de outro paciente recusadas; a inclusão
// cria o participante com o consentimento e o evento 'inclusao' e liga a triagem; a saída sem motivo recusada e com
// motivo grava a saída e o evento 'saida'; a visita grava o evento; a versão velha recebe 409; a sessão de outro
// estabelecimento recebe 404; tudo vai à trilha de auditoria. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { inserirMinimo } from '../suprimentos/massa-propria.spec-util.js';
import { PesquisaClinicaPropria } from './pesquisa-clinica-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c3020pq';
const P2 = `${P}b`;
const COD = (s: string) => `${P}${s}`.toUpperCase();
const CID = 'Z99P1';

async function limpar(e: Escritor): Promise<void> {
  const ests = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
  const estudos = `SELECT id FROM pesquisa_clinica WHERE estabelecimento_id IN (${ests})`;
  await e.executar(`DELETE FROM triagem_elegibilidade_pesquisa WHERE estabelecimento_id IN (${ests})`, [
    P,
    P2,
  ]);
  await e.executar(
    `DELETE FROM participante_pesquisa_evento WHERE participante_pesquisa_id IN
       (SELECT id FROM participante_pesquisa WHERE pesquisa_clinica_id IN (${estudos}))`,
    [P, P2],
  );
  await e.executar(`DELETE FROM participante_pesquisa WHERE pesquisa_clinica_id IN (${estudos})`, [P, P2]);
  await e.executar(`DELETE FROM pesquisa_clinica_criterio WHERE pesquisa_clinica_id IN (${estudos})`, [
    P,
    P2,
  ]);
  await e.executar(`DELETE FROM pesquisa_clinica_equipe WHERE pesquisa_clinica_id IN (${estudos})`, [P, P2]);
  await e.executar(`DELETE FROM pesquisa_clinica WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM anexo_prontuario WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar('DELETE FROM arquivo WHERE chave_armazenamento LIKE ?', [`teste/${P}/%`]);
  await e.executar('DELETE FROM tipo_anexo WHERE codigo = ?', [COD('T')]);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar('DELETE FROM termo_terminologia WHERE codigo_termo = ?', [CID]);
  const pf = 'SELECT id FROM pessoa_fisica WHERE nome LIKE ?';
  await e.executar(`DELETE FROM profissional WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`% ${COD('')}`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PesquisaClinicaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PesquisaClinicaPropria;
  let m: {
    usuario: number;
    est: number;
    prof: number;
    pacA: number;
    pacB: number;
    anexoA: number;
    anexoB: number;
  };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const r422 = { problema: { status: 422 } };
  let estudo = 0;
  let triagemA = 0;
  let participante = 0;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PesquisaClinicaPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const categoria = await um('SELECT MIN(id) AS id FROM categoria_atendimento');
      const caraterTiss = await um('SELECT MIN(id) AS id FROM carater_atendimento_tiss');
      const fonte = await um('SELECT MIN(id) AS id FROM fonte_pagadora');
      const sexo = await um('SELECT MIN(id) AS id FROM sexo');
      const terminologia = await um('SELECT MIN(id) AS id FROM terminologia');
      if (!usuario || !categoria || !caraterTiss || !fonte || !sexo || !terminologia)
        throw new Error(
          'O cliente de teste precisa de usuário, categoria, caráter, fonte, sexo e terminologia.',
        );
      const novoEst = (codigo: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const min = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, P);
      const termo = await min('termo_terminologia', {
        terminologia_id: terminologia,
        codigo_termo: CID,
        descricao: 'DIAGNOSTICO SINTETICO',
      });
      const pfProf = await min('pessoa_fisica', { nome: `PROFISSIONAL SINTETICO ${COD('')}` });
      const prof = await min('profissional', { pessoa_fisica_id: pfProf, tipo: 'corpo_clinico' });
      const tipoAnexo = await min('tipo_anexo', { codigo: COD('T'), descricao: 'TCLE SINTETICO' });
      const paciente = async (n: string, cid: number | null) => {
        const pf = await min('pessoa_fisica', {
          nome: `PACIENTE ${n} SINTETICO ${COD('')}`,
          data_nascimento: '1980-05-01',
          sexo_id: sexo,
        });
        const pac = await min('paciente', {
          pessoa_fisica_id: pf,
          situacao: 'ativo',
          numero_prontuario: 930200 + n.charCodeAt(0),
        });
        await min('atendimento', {
          estabelecimento_id: est,
          numero: `${P}-${n}`,
          paciente_id: pac,
          categoria_atendimento_id: categoria,
          carater_atendimento_tiss_id: caraterTiss,
          fonte_pagadora_id: fonte,
          profissional_id: prof,
          entrada_em: agora,
          cid_principal_termo_terminologia_id: cid,
        });
        const arq = await min('arquivo', {
          finalidade: 'anexo',
          nome_original: `tcle-${n}.pdf`,
          tipo_mime: 'application/pdf',
          tamanho_bytes: 10,
          hash_sha256: '0'.repeat(64),
          chave_armazenamento: `teste/${P}/tcle-${n}.pdf`,
        });
        const anexo = await min('anexo_prontuario', {
          estabelecimento_id: est,
          paciente_id: pac,
          tipo_anexo_id: tipoAnexo,
          arquivo_id: arq,
          titulo: `TCLE ${n}`,
        });
        return { pac, anexo };
      };
      const a = await paciente('A', termo);
      const b = await paciente('B', null);
      return { usuario, est, prof, pacA: a.pac, pacB: b.pac, anexoA: a.anexo, anexoB: b.anexo };
    });
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('cadastra o estudo com o investigador na equipe e recusa a aprovação sem CAAE sem escrita', async () => {
    const r = await porta.cadastrarEstudo(ctx(), {
      codigo: 'EST-1',
      titulo: 'ESTUDO SINTETICO',
      fase: 'fase_3',
      inicio: '2026-01-01',
      investigador: m.prof,
    });
    estudo = r.estudo;
    expect(await ler('SELECT situacao, versao FROM pesquisa_clinica WHERE id = ?', [estudo])).toEqual([
      { situacao: 'em_aprovacao', versao: 1 },
    ]);
    expect(
      await ler(
        'SELECT profissional_id AS p, papel FROM pesquisa_clinica_equipe WHERE pesquisa_clinica_id = ?',
        [estudo],
      ),
    ).toEqual([{ p: m.prof, papel: 'investigador_principal' }]);
    await expect(
      porta.mudarSituacao(ctx(), estudo, { versao: 1, situacao: 'aprovada' }),
    ).rejects.toMatchObject(r422);
    expect((await ler('SELECT versao FROM pesquisa_clinica WHERE id = ?', [estudo]))[0]).toEqual({
      versao: 1,
    });
  });

  it('recusa o critério incoerente e grava os critérios do estudo', async () => {
    await expect(
      porta.incluirCriterio(ctx(), estudo, {
        tipo: 'inclusao',
        fonte: 'idade',
        descricao: 'Idade invertida',
        valorMinimo: 90,
        valorMaximo: 18,
      }),
    ).rejects.toMatchObject(r422);
    await expect(
      porta.incluirCriterio(ctx(), estudo, { tipo: 'inclusao', fonte: 'exame', descricao: 'Sem exame' }),
    ).rejects.toMatchObject(r422);
    await porta.incluirCriterio(ctx(), estudo, {
      tipo: 'inclusao',
      fonte: 'idade',
      descricao: 'Adulto',
      valorMinimo: 18,
      valorMaximo: 90,
    });
    await porta.incluirCriterio(ctx(), estudo, {
      tipo: 'inclusao',
      fonte: 'diagnostico',
      descricao: 'Diagnóstico do estudo',
      valorTexto: 'Z99P',
    });
    await porta.incluirCriterio(ctx(), estudo, {
      tipo: 'inclusao',
      fonte: 'manual',
      descricao: 'Disponibilidade para as visitas',
    });
    expect(
      await ler(
        'SELECT sequencia, fonte_dado AS fonte FROM pesquisa_clinica_criterio WHERE pesquisa_clinica_id = ? ORDER BY sequencia',
        [estudo],
      ),
    ).toEqual([
      { sequencia: 1, fonte: 'idade' },
      { sequencia: 2, fonte: 'diagnostico' },
      { sequencia: 3, fonte: 'manual' },
    ]);
  });

  it('recusa a triagem fora de recrutando e sem pacientes com a automática desligada', async () => {
    await expect(porta.triar(ctx(), estudo, { pacientes: [m.pacA] }, false)).rejects.toMatchObject(r422);
    await expect(porta.triar(ctx(), estudo, {}, false)).rejects.toMatchObject(r422);
    await porta.mudarSituacao(ctx(), estudo, {
      versao: 1,
      situacao: 'aprovada',
      numeroCaae: '12345678.9.0000.0001',
      aprovacaoEticaEm: '2026-01-10',
      aprovadoComite: true,
    });
    await porta.mudarSituacao(ctx(), estudo, { versao: 2, situacao: 'recrutando' });
    await expect(
      porta.mudarSituacao(ctx(), estudo, { versao: 2, situacao: 'suspensa' }),
    ).rejects.toMatchObject({
      problema: { status: 409 },
    });
    expect(
      await ler(
        'SELECT situacao, numero_caae AS caae, aprovado_comite AS c FROM pesquisa_clinica WHERE id = ?',
        [estudo],
      ),
    ).toEqual([{ situacao: 'recrutando', caae: '12345678.9.0000.0001', c: 1 }]);
    expect(
      (
        await ler('SELECT COUNT(*) AS n FROM triagem_elegibilidade_pesquisa WHERE pesquisa_clinica_id = ?', [
          estudo,
        ])
      )[0],
    ).toEqual({ n: 0 });
  });

  it('a triagem manual sugere só quem atende e não repete o candidato em aberto', async () => {
    const r = await porta.triar(ctx(), estudo, { pacientes: [m.pacA, m.pacB] }, false);
    expect(r).toMatchObject({ avaliados: 2, sugeridos: 1 });
    const t = await ler(
      `SELECT id, paciente_id AS pac, modo_geracao AS modo, situacao, criterios_atendidos AS j
         FROM triagem_elegibilidade_pesquisa WHERE pesquisa_clinica_id = ?`,
      [estudo],
    );
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ pac: m.pacA, modo: 'manual', situacao: 'identificado' });
    const j = (typeof t[0]!['j'] === 'string' ? JSON.parse(String(t[0]!['j'])) : t[0]!['j']) as {
      atendidos: unknown[];
      aConferir: unknown[];
    };
    expect(j.atendidos).toHaveLength(2);
    expect(j.aConferir).toHaveLength(1);
    triagemA = Number(t[0]!['id']);
    expect(await porta.triar(ctx(), estudo, { pacientes: [m.pacA] }, false)).toMatchObject({
      avaliados: 0,
      sugeridos: 0,
    });
  });

  it('recusa a inclusão sem TCLE e com anexo de outro paciente; inclui com o termo do próprio paciente', async () => {
    await expect(
      porta.avaliar(ctx(), triagemA, { versao: 1, decisao: 'incluido', avaliador: m.prof }),
    ).rejects.toMatchObject(r422);
    await expect(
      porta.avaliar(ctx(), triagemA, {
        versao: 1,
        decisao: 'incluido',
        consentimentoEm: '2026-02-01T10:00',
        anexo: m.anexoB,
      }),
    ).rejects.toMatchObject(r422);
    expect(
      (
        await ler('SELECT COUNT(*) AS n FROM participante_pesquisa WHERE pesquisa_clinica_id = ?', [estudo])
      )[0],
    ).toEqual({ n: 0 });
    const r = await porta.avaliar(ctx(), triagemA, {
      versao: 1,
      decisao: 'incluido',
      avaliador: m.prof,
      consentimentoEm: '2026-02-01T10:00',
      anexo: m.anexoA,
      codigoParticipante: 'P-001',
    });
    participante = Number(r.participante);
    const x = await ler(
      `SELECT paciente_id AS pac, situacao, codigo_participante AS cod, consentimento_em IS NOT NULL AS tcle,
              termo_consentimento_arquivo_id = (SELECT arquivo_id FROM anexo_prontuario WHERE id = ?) AS termo
         FROM participante_pesquisa WHERE id = ?`,
      [m.anexoA, participante],
    );
    expect(x).toEqual([{ pac: m.pacA, situacao: 'incluido', cod: 'P-001', tcle: 1, termo: 1 }]);
    expect(
      await ler(
        'SELECT situacao, participante_pesquisa_id AS p, avaliado_em IS NOT NULL AS av FROM triagem_elegibilidade_pesquisa WHERE id = ?',
        [triagemA],
      ),
    ).toEqual([{ situacao: 'incluido', p: participante, av: 1 }]);
    await expect(porta.avaliar(ctx(), triagemA, { versao: 2, decisao: 'descartado' })).rejects.toMatchObject(
      r422,
    );
  });

  it('acompanha o participante: visita, saída sem motivo recusada e saída com motivo', async () => {
    await porta.registrarVisita(ctx(), participante, {
      ocorridoEm: '2026-02-15T09:30',
      observacao: 'Visita 1',
    });
    await expect(
      porta.mudarParticipante(ctx(), participante, { versao: 1, situacao: 'retirado' }),
    ).rejects.toMatchObject(r422);
    await porta.mudarParticipante(ctx(), participante, {
      versao: 1,
      situacao: 'retirado',
      motivo: 'Retirou o consentimento',
    });
    expect(
      await ler(
        'SELECT situacao, saida_em IS NOT NULL AS saiu, motivo_saida AS motivo FROM participante_pesquisa WHERE id = ?',
        [participante],
      ),
    ).toEqual([{ situacao: 'retirado', saiu: 1, motivo: 'Retirou o consentimento' }]);
    expect(
      await ler(
        'SELECT evento, situacao_nova AS nova FROM participante_pesquisa_evento WHERE participante_pesquisa_id = ? ORDER BY id',
        [participante],
      ),
    ).toEqual([
      { evento: 'inclusao', nova: 'incluido' },
      { evento: 'visita', nova: 'incluido' },
      { evento: 'saida', nova: 'retirado' },
    ]);
    await expect(
      porta.registrarVisita(ctx(), participante, { ocorridoEm: '2026-03-01T09:30', observacao: null }),
    ).rejects.toMatchObject(r422);
  });

  it('o painel e o estudo mostram o resultado; outro estabelecimento recebe 404 sem escrita', async () => {
    const painel = await porta.painel(ctx());
    expect(painel.estudos).toEqual([
      expect.objectContaining({ id: estudo, situacao: 'recrutando', participantes: 0, candidatos: 0 }),
    ]);
    const e = await porta.estudo(ctx(), estudo);
    expect(e).toMatchObject({ recruta: true, equipe: [{ profissional: m.prof }] });
    expect(e.participantes).toEqual([expect.objectContaining({ id: participante, situacao: 'retirado' })]);
    await expect(porta.estudo(ctx(P2), estudo)).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(porta.triar(ctx(P2), estudo, { pacientes: [m.pacB] }, false)).rejects.toMatchObject({
      problema: { status: 404 },
    });
    await expect(
      porta.mudarParticipante(ctx(P2), participante, { versao: 2, situacao: 'concluido' }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
  });

  it('cada gravação vai à trilha de auditoria do estabelecimento', async () => {
    const t = await ler(
      `SELECT entidade, COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? GROUP BY entidade ORDER BY entidade`,
      [m.est],
    );
    const entidades = t.map((x) => String(x['entidade']));
    expect(entidades).toEqual(
      expect.arrayContaining([
        'pesquisa_clinica',
        'pesquisa_clinica_criterio',
        'triagem_elegibilidade_pesquisa',
        'participante_pesquisa',
        'participante_pesquisa_evento',
      ]),
    );
  });
});
