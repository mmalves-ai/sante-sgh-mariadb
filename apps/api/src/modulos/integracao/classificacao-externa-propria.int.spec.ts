// Contrato de efeito da classificação de risco externa (F3.9, 08-INTG L140) contra o MariaDB real (cliente de teste):
// o ENVIO ATIVO dos perfis (a MFN^M13 pelo perfil de mensagem HL7 do sistema de triagem na fila de saída, idempotente
// pelo pacote e pelo dia, ponto de saída MLLP criado) e a ENTRADA pela credencial do sistema de triagem (resumo da
// chave, escopo, usuário técnico como autor; sistema do corpo diferente recusado), seguida da APLICAÇÃO (a recebida
// vira classificação interna concluída, com o classificador sendo o profissional de quem aplica; quem aplica sem vínculo
// profissional é recusado sem gravar nada). O reenvio do mesmo pacote decide pela situação da mensagem do dia (viva:
// repetida; morta: recusada; descartada: nova). Massa SINTÉTICA com o código do teste (o aplicador e o usuário sem
// vínculo são sintéticos; os demais usuários e o profissional do atendimento são ids já existentes, só lidos).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { createHash } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaClassificacaoExternaPropria } from './classificacao-externa-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1027ce';
const SIS = 'c1027-tri';
const SEGREDO = 'segredo-sintetico-c1027-0123456789';
const SEGREDO_SEM = 'segredo-sintetico-c1027-sem-escopo';
const FONTE = 'teste-c1027';
const NOME_PAC = 'c1027 Paciente sintético';
const NOME_CLASS = 'c1027 Classificador sintético';
/** CPF fictício (só o formato): liga o usuário aplicador à pessoa e ao profissional sintéticos. */
const CPF_CLASS = '99910270271';
const basic = (id: string, s: string) => `Basic ${Buffer.from(`${id}:${s}`).toString('base64')}`;

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(`DELETE FROM mensagem_integracao_saida WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM ponto_integracao WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM classificacao_externa_recebida WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    `UPDATE classificacao_risco SET anterior_classificacao_risco_id = NULL WHERE estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM classificacao_risco WHERE estabelecimento_id IN ${est}`, [P]);
  const prot =
    "(SELECT x.id FROM (SELECT id FROM protocolo_classificacao_risco WHERE codigo = 'c1027-prot') x)";
  await e.executar(
    `DELETE FROM protocolo_classificacao_estabelecimento WHERE protocolo_classificacao_risco_id IN ${prot}`,
  );
  await e.executar(
    `DELETE FROM protocolo_classificacao_risco_versao WHERE protocolo_classificacao_risco_id IN ${prot}`,
  );
  await e.executar("DELETE FROM protocolo_classificacao_risco WHERE codigo = 'c1027-prot'");
  await e.executar("DELETE FROM perfil_prioridade_externa WHERE codigo LIKE 'c1027-%'");
  const sis = "(SELECT x.id FROM (SELECT id FROM sistema_externo WHERE codigo LIKE 'c1027-%') x)";
  await e.executar(`DELETE FROM perfil_mensagem_hl7 WHERE sistema_externo_id IN ${sis}`);
  await e.executar("DELETE FROM parceiro_dados WHERE codigo LIKE 'c1027-%'");
  const cli = "(SELECT x.id FROM (SELECT id FROM cliente_api WHERE codigo LIKE 'c1027-%') x)";
  await e.executar(`DELETE FROM chave_api WHERE cliente_api_id IN ${cli}`);
  await e.executar("DELETE FROM cliente_api WHERE codigo LIKE 'c1027-%'");
  await e.executar("DELETE FROM sistema_externo WHERE codigo LIKE 'c1027-%'");
  await e.executar('DELETE FROM evento_hl7 WHERE versao_fonte = ?', [FONTE]);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM categoria_atendimento WHERE codigo = 'c1027-pa'");
  const pf = '(SELECT x.id FROM (SELECT id FROM pessoa_fisica WHERE nome = ?) x)';
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN ${pf}`, [NOME_PAC]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome = ?', [NOME_PAC]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
  await e.executar(`DELETE FROM profissional WHERE pessoa_fisica_id IN ${pf}`, [NOME_CLASS]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome = ?', [NOME_CLASS]);
  await e.executar("DELETE FROM usuario WHERE login IN ('c1027.aplicador', 'c1027.semvinculo')");
}

describe.skipIf(SEM_BANCO)(
  'Classificação externa: envio ativo e entrada pela credencial (contrato de efeito)',
  () => {
    let nucleo: NucleoProprio;
    let cla: PortaClassificacaoExternaPropria;
    let m: {
      est: number;
      usuario: number;
      tecnico: number;
      prof: number;
      atd: number;
      paciente: number;
      aplicador: number;
      classificador: number;
      semVinculo: number;
    };
    const ctx = () => ({ cliente: CLIENTE, usuario: m.usuario, correlacao: P, hospital: P });
    const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
    const erro = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        return (e as { problema?: { status?: number; codigo?: string } }).problema ?? {};
      }
      throw new Error('Era para recusar.');
    };

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
        await limpar(e);
        const agora = new Date();
        const ontem = new Date(agora.getTime() - 86_400_000);
        const us = await e.consultar('SELECT id FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 2');
        const prof = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
        if (us.length < 2 || !prof?.['id'])
          throw new Error('O cliente de teste precisa de dois usuários e de um profissional.');
        const est = await e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
          [P, agora],
        );
        const pa = await e.inserir(
          `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em)
         VALUES ('c1027-pa', 'PA (teste)', 'pronto_atendimento', ?)`,
          [agora],
        );
        const sis = await e.inserir(
          `INSERT INTO sistema_externo (codigo, nome, categoria, finalidade, criado_em)
         VALUES (?, 'Triagem (teste)', 'triagem', 'Classificação de risco (teste)', ?)`,
          [SIS, agora],
        );
        await e.executar(
          `INSERT INTO sistema_externo (codigo, nome, categoria, finalidade, criado_em)
         VALUES ('c1027-lab', 'Laboratório (teste)', 'laboratorio', 'Exames (teste)', ?)`,
          [agora],
        );
        let ev = await e.uma(
          "SELECT id FROM evento_hl7 WHERE codigo_hl7 = 'MFN^M13' ORDER BY versao_hl7 DESC LIMIT 1",
        );
        if (!ev)
          ev = {
            id: await e.inserir(
              `INSERT INTO evento_hl7 (codigo_hl7, tipo_mensagem, codigo_evento, estrutura_mensagem, versao_hl7, descricao,
               vigencia_inicio, versao_fonte, criado_em)
             VALUES ('MFN^M13', 'MFN', 'M13', 'MFN_M13', '2.5.1', 'Arquivo mestre geral (teste)', '2000-01-01', ?, ?)`,
              [FONTE, agora],
            ),
          };
        // O perfil de mensagem nasce DESLIGADO: o primeiro envio é recusado por ele.
        await e.executar(
          `INSERT INTO perfil_mensagem_hl7 (sistema_externo_id, evento_hl7_id, versao_hl7, estrutura_mensagem, ativo,
           criado_em) VALUES (?, ?, '2.5.1', 'MFN_M13', FALSE, ?)`,
          [sis, ev['id'], agora],
        );
        const cliente = (codigo: string, sistema: number | null, tecnico: number | null) =>
          e.inserir(
            `INSERT INTO cliente_api (codigo, nome, identificador_cliente, sistema_externo_id, usuario_id, criado_em)
           VALUES (?, 'Cliente (teste)', ?, ?, ?, ?)`,
            [codigo, `${codigo}.cli`, sistema, tecnico, agora],
          );
        const chave = (cli: number, segredo: string) =>
          e.executar(
            `INSERT INTO chave_api (cliente_api_id, sequencia, prefixo, hash_chave, valida_desde, criado_em)
           VALUES (?, 1, ?, ?, ?, ?)`,
            [
              cli,
              `c1027${cli}`.slice(0, 16),
              createHash('sha256').update(segredo).digest('hex'),
              ontem,
              agora,
            ],
          );
        const tecnico = Number(us[1]!['id']);
        const cTri = await cliente('c1027-tri', sis, tecnico);
        const cSem = await cliente('c1027-sem', sis, tecnico);
        await chave(cTri, SEGREDO);
        await chave(cSem, SEGREDO_SEM);
        // O parceiro HL7 do sistema de triagem (quem o worker entrega) com o escopo da entrada; o outro, sem escopo.
        await e.executar(
          `INSERT INTO parceiro_dados (codigo, nome, tipo, sistema_externo_id, cliente_api_id, canal, escopos, finalidade,
           base_legal, criado_em)
         VALUES ('c1027-par', 'Triagem (teste)', 'hl7', ?, ?, 'oie-classificacao-adt', '["classificacao.enviar"]',
           'Classificação de risco (teste)', 'tutela-da-saude', ?)`,
          [sis, cTri, agora],
        );
        await e.executar(
          `INSERT INTO protocolo_classificacao_risco (codigo, nome, tipo, situacao, criado_em)
         VALUES ('c1027-prot', 'Protocolo (teste)', 'institucional', 'publicado', ?)`,
          [agora],
        );
        const prot = await e.uma("SELECT id FROM protocolo_classificacao_risco WHERE codigo = 'c1027-prot'");
        await e.executar(
          `INSERT INTO protocolo_classificacao_risco_versao (protocolo_classificacao_risco_id, operacao, dados, ocorrido_em,
           numero_versao, vigencia_inicio, motivo_publicacao, publicado_por_usuario_id, criado_em)
         VALUES (?, 'inclusao', '{}', ?, '1.0', ?, 'Teste', ?, ?)`,
          [prot!['id'], agora, ontem, us[0]!['id'], agora],
        );
        await e.executar(
          `INSERT INTO protocolo_classificacao_estabelecimento (protocolo_classificacao_risco_id, estabelecimento_id,
           vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)`,
          [prot!['id'], est, ontem, agora],
        );
        await e.executar('SET FOREIGN_KEY_CHECKS = 0');
        try {
          const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
            NOME_PAC,
            agora,
          ]);
          const pront = await e.uma('SELECT COALESCE(MAX(numero_prontuario), 0) + 1 AS n FROM paciente');
          const paciente = await e.inserir(
            'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
            [pf, pront!['n'], agora],
          );
          const atd = await e.inserir(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)`,
            [est, `${P}-pa`, paciente, pa, prof['id'], new Date(agora.getTime() - 3_600_000), agora],
          );
          // O aplicador: usuário com CPF da pessoa que tem vínculo profissional ativo (o caminho real da aplicação,
          // pois nenhuma entrada grava o profissional na recebida); o outro, sem CPF nem vínculo.
          const pfc = await e.inserir('INSERT INTO pessoa_fisica (nome, cpf, criado_em) VALUES (?, ?, ?)', [
            NOME_CLASS,
            CPF_CLASS,
            agora,
          ]);
          const classificador = await e.inserir(
            "INSERT INTO profissional (pessoa_fisica_id, tipo, situacao, criado_em) VALUES (?, 'corpo_clinico', 'ativo', ?)",
            [pfc, agora],
          );
          const aplicador = await e.inserir(
            "INSERT INTO usuario (login, nome, cpf, criado_em) VALUES ('c1027.aplicador', 'Aplicador (teste)', ?, ?)",
            [CPF_CLASS, agora],
          );
          const semVinculo = await e.inserir(
            "INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES ('c1027.semvinculo', 'Sem vínculo (teste)', TRUE, ?)",
            [agora],
          );
          return {
            aplicador,
            classificador,
            semVinculo,
            est,
            usuario: Number(us[0]!['id']),
            tecnico,
            prof: Number(prof['id']),
            atd,
            paciente,
          };
        } finally {
          await e.executar('SET FOREIGN_KEY_CHECKS = 1');
        }
      });
      cla = new PortaClassificacaoExternaPropria(
        nucleo,
        CLIENTE,
        nucleo.criarExecutor({
          // Diagnóstico do erro interno do executor (código e causa do banco; nunca dado de pessoa).
          log: (msg: string, d: unknown) => console.error(msg, JSON.stringify(d)),
        } as Parameters<NucleoProprio['criarExecutor']>[0]),
      );
    }, 120_000);

    afterAll(async () => {
      if (!nucleo) return;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }, 120_000);

    it('envio ativo: recusado sem perfil de mensagem; a MFN^M13 vai à fila de saída, idempotente pelo pacote', async () => {
      await cla.gravarPerfil(ctx(), {
        codigo: 'c1027-gest',
        descricao: 'Gestante',
        sistemaCodigo: SIS,
        codigoExterno: 'G',
        condicaoPreferencial: 'gestante',
        ordemPrioridade: 2,
      });
      await cla.gravarPerfil(ctx(), {
        codigo: 'c1027-ido',
        descricao: 'Idoso',
        sistemaCodigo: SIS,
        codigoExterno: 'I',
        condicaoPreferencial: 'idoso',
        ordemPrioridade: 1,
      });
      expect((await erro(cla.enviarPerfis(ctx(), { sistema: SIS }))).codigo).toBe('sem-perfil-mensagem');
      expect((await erro(cla.enviarPerfis(ctx(), { sistema: 'c1027-lab' }))).codigo).toBe(
        'sistema-nao-triagem',
      );
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, (e) =>
        e.executar(
          `UPDATE perfil_mensagem_hl7 SET ativo = TRUE WHERE sistema_externo_id =
           (SELECT id FROM sistema_externo WHERE codigo = ?)`,
          [SIS],
        ),
      );
      // Canal que o motor de integração não conhece: recusado (a mensagem morreria no enviador do worker).
      const canal = (c: string) =>
        nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, (e) =>
          e.executar("UPDATE parceiro_dados SET canal = ? WHERE codigo = 'c1027-par'", [c]),
        );
      await canal('apoio');
      expect((await erro(cla.enviarPerfis(ctx(), { sistema: SIS }))).codigo).toBe('sem-parceiro-hl7');
      await canal('oie-classificacao-adt');
      const agora = new Date();
      const a = await cla.enviarPerfis(ctx(), { sistema: SIS }, agora);
      expect(a.repetida).toBe(false);
      expect(a.perfis).toBeGreaterThanOrEqual(2);
      const b = await cla.enviarPerfis(ctx(), { sistema: SIS }, agora);
      expect(b).toMatchObject({ id: a.id, repetida: true });
      const [base] = await ler(
        'SELECT chave_idempotencia AS chave, conteudo FROM mensagem_integracao_saida WHERE id = ?',
        [a.id],
      );
      const [s] = await ler(
        `SELECT s.situacao, s.formato, s.tipo_mensagem, s.conteudo, s.hash_sha256, s.criado_por, s.evento_hl7_id,
              p.direcao, p.transporte, p.formato_conteudo, p.codigo AS ponto
         FROM mensagem_integracao_saida s JOIN ponto_integracao p ON p.id = s.ponto_integracao_id WHERE s.id = ?`,
        [a.id],
      );
      expect(s).toMatchObject({
        situacao: 'pendente',
        formato: 'hl7v2',
        tipo_mensagem: 'classificacao.perfis',
        direcao: 'saida',
        transporte: 'mllp',
        formato_conteudo: 'hl7v2',
        ponto: 'parceiro.c1027-par.saida',
      });
      expect(Number(s!['criado_por'])).toBe(m.usuario);
      const linhas = String(s!['conteudo']).split('\r');
      expect(linhas[0]).toMatch(
        /^MSH\|\^~\\&\|SGH\|C1027CE\|C1027-TRI\|C1027-TRI\|\d{14}\|\|MFN\^M13\^MFN_M13\|PRF/,
      );
      expect(linhas[0]!.endsWith('|T|2.5.1')).toBe(true);
      expect(linhas[1]!.startsWith('MFI|PRIORIDADE^Perfis de prioridade^L||REP|')).toBe(true);
      const mfe = linhas.filter((l) => l.startsWith('MFE|'));
      expect(mfe.length).toBe(a.perfis);
      const nossos = mfe.filter((l) => /\|[IG]\^/.test(l));
      expect(nossos.map((l) => l.split('|')[4])).toEqual(['I^Idoso^L^idoso^^L', 'G^Gestante^L^gestante^^L']);
      expect(String(s!['hash_sha256'])).toBe(
        createHash('sha256').update(String(s!['conteudo'])).digest('hex'),
      );
      // Pacote mudado (perfil novo ativo): entra outra mensagem; o mesmo ponto de saída é reaproveitado.
      await cla.gravarPerfil(ctx(), {
        codigo: 'c1027-mob',
        descricao: 'Mobilidade reduzida',
        sistemaCodigo: SIS,
        codigoExterno: 'M',
        condicaoPreferencial: 'mobilidade_reduzida',
        ordemPrioridade: 3,
      });
      const c = await cla.enviarPerfis(ctx(), { sistema: SIS }, agora);
      expect(c.repetida).toBe(false);
      expect(c.perfis).toBe(a.perfis + 1);
      const pontos = await ler('SELECT COUNT(*) AS n FROM ponto_integracao WHERE estabelecimento_id = ?', [
        m.est,
      ]);
      expect(Number(pontos[0]!['n'])).toBe(1);
      const fila = await ler(
        "SELECT COUNT(*) AS n FROM mensagem_integracao_saida WHERE estabelecimento_id = ? AND situacao = 'pendente'",
        [m.est],
      );
      expect(Number(fila[0]!['n'])).toBe(2);

      // Reenvio do pacote do dia pela situação da mensagem. A morte e o descarte são o que o worker e o tratamento da
      // fila de mortos gravam (aqui, pela mesma coluna). Morta: recusada, apontando o reprocessamento, e nada entra.
      const situacao = (id: number, sit: string) =>
        nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, (e) =>
          e.executar('UPDATE mensagem_integracao_saida SET situacao = ? WHERE id = ?', [sit, id]),
        );
      const quantas = async () =>
        Number(
          (
            await ler('SELECT COUNT(*) AS n FROM mensagem_integracao_saida WHERE estabelecimento_id = ?', [
              m.est,
            ])
          )[0]!['n'],
        );
      // O pacote volta a ser o do primeiro envio (o perfil novo sai), para reenviar o mesmo pacote.
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, (e) =>
        e.executar("UPDATE perfil_prioridade_externa SET ativo = FALSE WHERE codigo = 'c1027-mob'"),
      );
      for (const sit of ['erro', 'rejeitada', 'expirada']) {
        await situacao(a.id, sit);
        const r = await erro(cla.enviarPerfis(ctx(), { sistema: SIS }, agora));
        expect([r.status, r.codigo]).toEqual([422, 'envio-anterior-falhou']);
      }
      expect(await quantas()).toBe(2);
      // Ainda na fila ou entregue: repetida (nada novo).
      for (const sit of ['enviando', 'enviada', 'confirmada']) {
        await situacao(a.id, sit);
        expect(await cla.enviarPerfis(ctx(), { sistema: SIS }, agora)).toMatchObject({
          id: a.id,
          repetida: true,
        });
      }
      // Descartada no tratamento: entra uma nova, com a chave e o MSH-10 seguintes; a nova fica repetida depois.
      await situacao(a.id, 'cancelada');
      const d = await cla.enviarPerfis(ctx(), { sistema: SIS }, agora);
      expect(d).toMatchObject({ repetida: false, chave: `${String(base!['chave'])}:r1` });
      expect(d.id).not.toBe(a.id);
      expect(await cla.enviarPerfis(ctx(), { sistema: SIS }, agora)).toMatchObject({
        id: d.id,
        repetida: true,
      });
      const [nova] = await ler('SELECT situacao, conteudo FROM mensagem_integracao_saida WHERE id = ?', [
        d.id,
      ]);
      expect(nova!['situacao']).toBe('pendente');
      const msh10 = (c: unknown) => String(c).split('\r')[0]!.split('|')[9];
      expect(msh10(nova!['conteudo'])).toMatch(/R1$/);
      expect(msh10(nova!['conteudo'])).not.toBe(msh10(base!['conteudo']));
      expect(await quantas()).toBe(3);
    }, 120_000);

    it('entrada pela credencial do sistema de triagem, com o usuário técnico na trilha, e a aplicação', async () => {
      const agora = new Date();
      const corpo = (id: string, extra: Record<string, unknown> = {}) => ({
        atendimentoId: m.atd,
        identificadorExterno: id,
        codigoPrioridade: 'AMARELO',
        cor: 'amarelo',
        tempoAlvoMinutos: 60,
        perfilCodigoExterno: 'G',
        classificadoEm: new Date(agora.getTime() - 10 * 60_000).toISOString(),
        ...extra,
      });
      expect((await erro(cla.receberPelaCredencial(P, 'Bearer x', corpo('E-0')))).status).toBe(401);
      expect(
        (await erro(cla.receberPelaCredencial(P, basic('c1027-tri.cli', `${SEGREDO}x`), corpo('E-0'))))
          .status,
      ).toBe(401);
      expect(
        (await erro(cla.receberPelaCredencial(P, basic('c1027-sem.cli', SEGREDO_SEM), corpo('E-0')))).codigo,
      ).toBe('fora-do-escopo');
      expect(
        (
          await erro(
            cla.receberPelaCredencial(
              P,
              basic('c1027-tri.cli', SEGREDO),
              corpo('E-0', { sistemaCodigo: 'c1027-lab' }),
            ),
          )
        ).codigo,
      ).toBe('sistema-da-credencial');
      const r = await cla.receberPelaCredencial(P, basic('c1027-tri.cli', SEGREDO), corpo('E-1'), agora);
      expect(r).toMatchObject({ situacao: 'recebida', repetida: false });
      const rep = await cla.receberPelaCredencial(P, basic('c1027-tri.cli', SEGREDO), corpo('E-1'), agora);
      expect(rep).toMatchObject({ id: r.id, repetida: true });
      const [g] = await ler(
        `SELECT r.criado_por, s.codigo AS sistema, r.situacao, r.origem, r.perfil_prioridade_externa_id AS perfil
         FROM classificacao_externa_recebida r JOIN sistema_externo s ON s.id = r.sistema_externo_id WHERE r.id = ?`,
        [r.id],
      );
      expect(g).toMatchObject({ sistema: SIS, situacao: 'recebida', origem: 'integracao' });
      expect(Number(g!['criado_por'])).toBe(m.tecnico);
      expect(g!['perfil']).not.toBeNull();
      const trilha = await ler(
        `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE usuario_id = ? AND estabelecimento_id = ?`,
        [m.tecnico, m.est],
      );
      expect(Number(trilha[0]!['n'])).toBeGreaterThan(0);

      // A aplicação pelo caminho real: a recebida que entrou pela credencial não traz o profissional (nenhuma entrada o
      // grava), então o classificador é o profissional de quem aplica.
      const [semProf] = await ler('SELECT profissional_id FROM classificacao_externa_recebida WHERE id = ?', [
        r.id,
      ]);
      expect(semProf!['profissional_id']).toBeNull();
      // Quem aplica sem vínculo profissional ativo: recusado, e nada é gravado.
      const ctxDe = (usuario: number) => ({ ...ctx(), usuario });
      const rec = await erro(cla.aplicar(ctxDe(m.semVinculo), r.id));
      expect([rec.status, rec.codigo]).toEqual([422, 'sem-vinculo-assistencial']);
      const [intacta] = await ler(
        `SELECT r.situacao, r.classificacao_risco_id AS liga, r.versao,
                (SELECT COUNT(*) FROM classificacao_risco c WHERE c.atendimento_id = r.atendimento_id) AS internas
           FROM classificacao_externa_recebida r WHERE r.id = ?`,
        [r.id],
      );
      expect(intacta).toMatchObject({ situacao: 'recebida', liga: null });
      expect(Number(intacta!['internas'])).toBe(0);
      const ap = await cla.aplicar(ctxDe(m.aplicador), r.id);
      expect(ap.reclassificou).toBeNull();
      expect((await erro(cla.aplicar(ctxDe(m.aplicador), r.id))).codigo).toBe('nao-vigente');
      const [interna] = await ler(
        `SELECT c.situacao, c.origem, c.tempo_alvo_minutos AS t, n.codigo AS cor, c.paciente_id AS pac,
              TIMESTAMPDIFF(MINUTE, c.classificado_em, c.prazo_atendimento_em) AS prazo,
              r.situacao AS sr, r.classificacao_risco_id AS liga
              , c.classificador_profissional_id AS classificador, c.criado_por
         FROM classificacao_risco c JOIN nivel_prioridade n ON n.id = c.nivel_prioridade_id
         JOIN classificacao_externa_recebida r ON r.id = ? WHERE c.id = ?`,
        [r.id, ap.classificacaoRiscoId],
      );
      expect(interna).toMatchObject({
        situacao: 'concluida',
        origem: 'integracao',
        cor: 'amarelo',
        sr: 'aplicada',
      });
      expect([Number(interna!['t']), Number(interna!['prazo']), Number(interna!['pac'])]).toEqual([
        60,
        60,
        m.paciente,
      ]);
      expect(Number(interna!['liga'])).toBe(ap.classificacaoRiscoId);
      expect(Number(interna!['classificador'])).toBe(m.classificador);
      expect(Number(interna!['criado_por'])).toBe(m.aplicador);
    }, 120_000);
  },
);
