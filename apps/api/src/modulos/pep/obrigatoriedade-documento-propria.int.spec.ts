// Contrato de efeito da obrigatoriedade de documentos (F7, 03-PEP L132) contra o MariaDB real (cliente de teste). Massa
// SINTÉTICA com o código "c2028od": dois estabelecimentos fictícios, um setor, dois pacientes fictícios (um com 70 anos,
// outro com 30), um profissional e dois atendimentos abertos em 2030 com o mesmo diagnóstico (nenhuma pessoa real).
// Dois modelos de documento sintéticos publicados. Sexo, categoria, caráter, fonte e o termo CID-10 são ids já existentes do cliente de teste (só
// os ids e o código do termo são lidos; sem termo de CID-10 no cliente, um termo sintético é criado).
// Prova o que fica no banco: a regra por diagnóstico (categoria CID) com prazo e bloqueio e a regra por setor e faixa
// etária gravadas com a trilha; a faixa invertida recusada sem escrita; a lista do profissional com a pendência do
// diagnóstico nos dois pacientes e a do setor e idade só no paciente de 70 anos, vencida e bloqueante primeiro; o
// registro clínico do modelo exigido tira a pendência; a alteração pela versão (conflito 409), o CID retirado marcado
// (não apagado) e recolocado pela mesma linha; a regra desativada fica no banco e sai da lista; a sessão de outro
// estabelecimento recebe 404 sem escrita; o atendimento encerrado há poucos dias sem o documento do fechamento continua
// na lista (o encerrado há mais de 30 dias e o cancelado não); a regra de todos os estabelecimentos guarda a origem,
// recusa setor sem escrita e só é alterada ou desativada pelo estabelecimento que a criou (403 no outro, sem escrita).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { inserirMinimo } from '../suprimentos/massa-propria.spec-util.js';
import { randomUUID } from 'node:crypto';
import { PortaAtendimentoPropria } from '../atendimento/porta-propria.js';
import {
  conferirDocumentosExigidos,
  PortaObrigatoriedadeDocumentoPropria,
} from './obrigatoriedade-documento-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c2028od';
const P2 = `${P}b`;
const COD = (s: string) => `${P}${s}`.toUpperCase();
const TERMO_SINTETICO = 'U9928';
const AGORA = new Date('2030-03-10T12:00:00.000Z');

async function limpar(e: Escritor): Promise<void> {
  const ests = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
  const daMassa = `estabelecimento_id IN (${ests}) OR estabelecimento_origem_id IN (${ests})`;
  const regras = `SELECT id FROM regra_obrigatoriedade_documento WHERE ${daMassa}`;
  await e.executar(
    `DELETE FROM regra_obrigatoriedade_cid WHERE regra_obrigatoriedade_documento_id IN (${regras})`,
    [P, P2, P, P2],
  );
  await e.executar(`DELETE FROM regra_obrigatoriedade_documento WHERE ${daMassa}`, [P, P2, P, P2]);
  await e.executar(`DELETE FROM registro_assistencial WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  const mods = 'SELECT id FROM modelo_documento_clinico WHERE codigo LIKE ?';
  await e.executar(
    "UPDATE modelo_documento_clinico SET situacao = 'rascunho', publicada_modelo_documento_versao_id = NULL WHERE codigo LIKE ?",
    [`${COD('')}%`],
  );
  await e.executar(`DELETE FROM modelo_documento_versao WHERE modelo_documento_clinico_id IN (${mods})`, [
    `${COD('')}%`,
  ]);
  await e.executar('DELETE FROM modelo_documento_clinico WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar(`DELETE FROM diagnostico_atendimento WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM integracao_mensagem WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(
    `DELETE FROM atendimento_situacao_historico WHERE atendimento_id IN (SELECT id FROM atendimento WHERE estabelecimento_id IN (${ests}))`,
    [P, P2],
  );
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  const pf = 'SELECT id FROM pessoa_fisica WHERE nome LIKE ?';
  await e.executar(`DELETE FROM profissional WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`% ${COD('')}`]);
  await e.executar('DELETE FROM termo_terminologia WHERE codigo_termo = ? AND descricao = ?', [
    TERMO_SINTETICO,
    `TERMO SINTETICO ${COD('')}`,
  ]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)(
  'PortaObrigatoriedadeDocumentoPropria contra o MariaDB (contrato de efeito)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaObrigatoriedadeDocumentoPropria;
    let m: {
      usuario: number;
      est: number;
      setor: number;
      modelo1: number;
      modelo2: number;
      categoria: string;
      atA: number;
      atB: number;
      pacienteA: number;
      pacienteB: number;
      categoriaAt: number;
      caraterTiss: number;
      fonte: number;
      profissional: number;
    };
    const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
    const ler = (sql: string, p: unknown[] = []) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
        Record<string, unknown>[]
      >;
    const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))[0]?.['n'] ?? 0);
    const regrasDoEst = () =>
      contar(
        'SELECT COUNT(*) AS n FROM regra_obrigatoriedade_documento r JOIN estabelecimento e ON e.id = r.estabelecimento_id WHERE e.codigo IN (?, ?)',
        [P, P2],
      );
    const cidsDa = (regra: number) =>
      ler(
        `SELECT id, codigo_cid10, excluido_em IS NOT NULL AS excluido, excluido_por FROM regra_obrigatoriedade_cid
        WHERE regra_obrigatoriedade_documento_id = ? ORDER BY codigo_cid10`,
        [regra],
      );
    let regraCid = 0;
    let regraSetor = 0;

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
        await limpar(e);
        const agora = new Date();
        const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
        const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
        const categoria = await um(
          "SELECT MIN(id) AS id FROM categoria_atendimento WHERE tipo_base = 'internacao'",
        );
        const caraterTiss = await um('SELECT MIN(id) AS id FROM carater_atendimento_tiss');
        const fonte = await um('SELECT MIN(id) AS id FROM fonte_pagadora');
        const sexo = await um('SELECT MIN(id) AS id FROM sexo');
        const tipoDocumento = await um('SELECT MIN(id) AS id FROM tipo_documento_clinico');
        if (!usuario || !categoria || !caraterTiss || !fonte || !sexo || !tipoDocumento)
          throw new Error(
            'O cliente de teste precisa de usuário, categoria de internação, caráter, fonte, sexo e tipo de documento.',
          );
        // Dois modelos sintéticos publicados (a versão publicada é exigida pelo CHECK do modelo).
        const modelo = async (n: string) => {
          const id = await inserirMinimo(
            e,
            'modelo_documento_clinico',
            {
              codigo: COD(`M${n}`),
              titulo: `MODELO SINTETICO ${n}`,
              tipo_documento_clinico_id: tipoDocumento,
              tipo_registro: 'evolucao',
              situacao: 'rascunho',
            },
            P,
          );
          const versao = await inserirMinimo(
            e,
            'modelo_documento_versao',
            {
              modelo_documento_clinico_id: id,
              numero_versao: 1,
              situacao: 'rascunho',
              operacao: 'inclusao',
              dados: '{}',
            },
            P,
          );
          await e.executar(
            "UPDATE modelo_documento_clinico SET situacao = 'publicado', publicada_modelo_documento_versao_id = ? WHERE id = ?",
            [versao, id],
          );
          return id;
        };
        const modelos = [{ id: await modelo('1') }, { id: await modelo('2') }];
        let termo = await e.uma<Record<string, unknown>>(
          `SELECT id, codigo_termo FROM termo_terminologia
          WHERE ativo AND codigo_termo REGEXP '^[A-Z][0-9]{2}[0-9A-Z]{0,3}$' ORDER BY id LIMIT 1`,
        );
        if (!termo) {
          const terminologia = await um('SELECT MIN(id) AS id FROM terminologia');
          const idTermo = await inserirMinimo(
            e,
            'termo_terminologia',
            {
              terminologia_id: terminologia,
              codigo_termo: TERMO_SINTETICO,
              descricao: `TERMO SINTETICO ${COD('')}`,
            },
            P,
          );
          termo = { id: idTermo, codigo_termo: TERMO_SINTETICO };
        }
        const novoEst = (codigo: string) =>
          e.inserir(
            `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
            [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
          );
        const est = await novoEst(P);
        await novoEst(P2);
        const min = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, P);
        const setor = await min('setor_funcional', {
          estabelecimento_id: est,
          codigo: COD('S1'),
          nome: 'SETOR SINTETICO',
          tipo: 'assistencial',
        });
        const pfProf = await min('pessoa_fisica', { nome: `PROFISSIONAL SINTETICO ${COD('')}` });
        const profissional = await min('profissional', { pessoa_fisica_id: pfProf, tipo: 'corpo_clinico' });
        const paciente = async (n: string, nascimento: string, prontuario: number) => {
          const pf = await min('pessoa_fisica', {
            nome: `PACIENTE ${n} SINTETICO ${COD('')}`,
            sexo_id: sexo,
            data_nascimento: nascimento,
          });
          return min('paciente', { pessoa_fisica_id: pf, situacao: 'ativo', numero_prontuario: prontuario });
        };
        const pacienteA = await paciente('A', '1960-01-15', 990_202_801);
        const pacienteB = await paciente('B', '2000-01-15', 990_202_802);
        const atendimento = (n: string, pac: number) =>
          min('atendimento', {
            estabelecimento_id: est,
            numero: `${P}-${n}`,
            paciente_id: pac,
            categoria_atendimento_id: categoria,
            carater_atendimento_tiss_id: caraterTiss,
            fonte_pagadora_id: fonte,
            profissional_id: profissional,
            setor_funcional_id: setor,
            situacao: 'aberto',
            entrada_em: new Date('2030-03-10T06:00:00.000Z'),
          });
        const atA = await atendimento('A', pacienteA);
        const atB = await atendimento('B', pacienteB);
        for (const [at, pac] of [
          [atA, pacienteA],
          [atB, pacienteB],
        ] as const)
          await min('diagnostico_atendimento', {
            estabelecimento_id: est,
            atendimento_id: at,
            paciente_id: pac,
            cid_termo_terminologia_id: Number(termo['id']),
            diagnosticado_em: new Date('2030-03-10T06:30:00.000Z'),
            profissional_id: profissional,
            situacao: 'ativo',
          });
        return {
          usuario,
          est,
          setor,
          modelo1: Number(modelos[0]?.['id']),
          modelo2: Number(modelos[1]?.['id']),
          categoria: String(termo['codigo_termo']).slice(0, 3),
          atA,
          atB,
          pacienteA,
          pacienteB,
          categoriaAt: categoria,
          caraterTiss,
          fonte,
          profissional,
        };
      });
      porta = new PortaObrigatoriedadeDocumentoPropria(nucleo, CLIENTE, () => AGORA);
    }, 120_000);

    afterAll(async () => {
      if (nucleo) {
        await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
        await nucleo.encerrar?.();
      }
    });

    it('inclui a regra por diagnóstico e a regra por setor e faixa etária; a faixa invertida é recusada sem escrita', async () => {
      const r1 = await porta.incluir(ctx(), {
        modelo: m.modelo1,
        cids: [m.categoria.toLowerCase()],
        momento: 'admissao',
        exigencia: 'bloquear',
        prazoMinutos: 60,
        vigenciaInicio: '2030-01-01',
      });
      regraCid = Number(r1['id']);
      expect(r1['cids']).toBe(1);
      const [linha] = await ler(
        `SELECT estabelecimento_id, modelo_documento_clinico_id AS modelo, momento, exigencia, prazo_minutos, ativo,
              criado_por, versao FROM regra_obrigatoriedade_documento WHERE id = ?`,
        [regraCid],
      );
      expect(linha).toMatchObject({
        estabelecimento_id: m.est,
        modelo: m.modelo1,
        momento: 'admissao',
        exigencia: 'bloquear',
        prazo_minutos: 60,
        versao: 1,
      });
      expect(Boolean(linha?.['ativo'])).toBe(true);
      expect((await cidsDa(regraCid)).map((c) => c['codigo_cid10'])).toEqual([m.categoria]);

      const r2 = await porta.incluir(ctx(), {
        modelo: m.modelo2,
        setor: m.setor,
        idadeMinimaDias: 60 * 365,
        momento: 'durante_atendimento',
        exigencia: 'alertar',
        prazoMinutos: 24 * 60,
        vigenciaInicio: '2030-01-01',
      });
      regraSetor = Number(r2['id']);
      const trilha = await contar(
        `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'regra_obrigatoriedade_documento' AND entidade_id IN (?, ?)`,
        [regraCid, regraSetor],
      );
      expect(trilha).toBeGreaterThanOrEqual(2);

      const antes = await regrasDoEst();
      await expect(
        porta.incluir(ctx(), {
          modelo: m.modelo1,
          idadeMinimaDias: 100,
          idadeMaximaDias: 10,
          momento: 'admissao',
          vigenciaInicio: '2030-01-01',
        }),
      ).rejects.toMatchObject({ problema: { status: 422 } });
      expect(await regrasDoEst()).toBe(antes);
    });

    it('a lista do profissional traz o diagnóstico nos dois e o setor com faixa etária só no de 70 anos', async () => {
      const r = await porta.pendencias(ctx(), {});
      expect(r.regrasAtivas).toBe(2);
      const a = r.itens.find((x) => x.atendimento === m.atA);
      const b = r.itens.find((x) => x.atendimento === m.atB);
      expect(a?.pendencias.map((p) => p.regra)).toEqual([regraCid, regraSetor]);
      expect(a?.pendencias[0]).toMatchObject({ vencida: true, exigencia: 'bloquear', modelo: m.modelo1 });
      expect(a?.pendencias[1]).toMatchObject({ vencida: false, exigencia: 'alertar' });
      expect(a?.pendencias[1]?.motivo).toContain('faixa etária');
      expect(b?.pendencias.map((p) => p.regra)).toEqual([regraCid]);
      expect(r.totais).toMatchObject({ atendimentos: 2, pendencias: 3, vencidas: 2, bloqueantes: 2 });
      const vencidas = await porta.pendencias(ctx(), { vencidas: '1', setor: String(m.setor) });
      expect(vencidas.totais.pendencias).toBe(2);
    });

    it('o registro clínico do modelo exigido tira a pendência do atendimento', async () => {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `doc-${P}` }, (e) =>
        inserirMinimo(
          e,
          'registro_assistencial',
          {
            estabelecimento_id: m.est,
            paciente_id: m.pacienteA,
            atendimento_id: m.atA,
            modelo_documento_clinico_id: m.modelo1,
            autor_profissional_id: m.profissional,
            autor_usuario_id: m.usuario,
            data_hora_clinica: new Date('2030-03-10T08:00:00.000Z'),
            data_hora_lancamento: new Date('2030-03-10T08:00:00.000Z'),
            situacao: 'finalizado',
            impressao_digital: 'a'.repeat(64),
          },
          P,
        ),
      );
      const r = await porta.pendenciasDoAtendimento(ctx(), m.atA);
      expect(r.pendencias.map((p) => p.regra)).toEqual([regraSetor]);
    });

    it('altera pela versão; o CID retirado fica marcado e o recolocado volta pela mesma linha', async () => {
      const base = {
        modelo: m.modelo1,
        momento: 'admissao',
        exigencia: 'bloquear',
        prazoMinutos: 60,
        vigenciaInicio: '2030-01-01',
      };
      await porta.alterar(ctx(), regraCid, { ...base, versao: 1, cids: [m.categoria, 'Z999'] });
      const comDois = await cidsDa(regraCid);
      expect(comDois.map((c) => c['codigo_cid10'])).toEqual([m.categoria, 'Z999'].sort());
      const idCategoria = comDois.find((c) => c['codigo_cid10'] === m.categoria)?.['id'];
      await expect(
        porta.alterar(ctx(), regraCid, { ...base, versao: 1, cids: ['Z999'] }),
      ).rejects.toMatchObject({ problema: { status: 409 } });
      const r = await porta.alterar(ctx(), regraCid, { ...base, versao: 2, cids: ['Z999'] });
      expect(r['retirados']).toBe(1);
      const retirado = (await cidsDa(regraCid)).find((c) => c['codigo_cid10'] === m.categoria);
      expect(retirado).toMatchObject({ excluido_por: m.usuario });
      expect(Number(retirado?.['excluido'])).toBe(1);
      // Sem o diagnóstico na regra, o paciente B fica sem pendência.
      expect((await porta.pendencias(ctx(), {})).itens.some((x) => x.atendimento === m.atB)).toBe(false);
      await porta.alterar(ctx(), regraCid, { ...base, versao: 3, cids: [m.categoria] });
      const volta = await cidsDa(regraCid);
      expect(volta.length).toBe(2);
      const recolocado = volta.find((c) => c['codigo_cid10'] === m.categoria);
      expect(recolocado?.['id']).toBe(idCategoria);
      expect(Number(recolocado?.['excluido'])).toBe(0);
      expect(Number(volta.find((c) => c['codigo_cid10'] === 'Z999')?.['excluido'])).toBe(1);
    });

    it('desativa pela versão sem apagar; a regra sai da lista; outro estabelecimento recebe 404 sem escrita', async () => {
      await expect(porta.ativar(ctx(P2), regraSetor, { versao: 1, ativo: false })).rejects.toMatchObject({
        problema: { status: 404 },
      });
      await expect(porta.pendenciasDoAtendimento(ctx(P2), m.atA)).rejects.toMatchObject({
        problema: { status: 404 },
      });
      await porta.ativar(ctx(), regraSetor, { versao: 1, ativo: false });
      const [linha] = await ler('SELECT ativo, versao FROM regra_obrigatoriedade_documento WHERE id = ?', [
        regraSetor,
      ]);
      expect(Number(linha?.['ativo'])).toBe(0);
      expect(Number(linha?.['versao'])).toBe(2);
      const r = await porta.pendencias(ctx(), {});
      expect(r.regrasAtivas).toBe(1);
      expect(r.itens.flatMap((x) => x.pendencias).some((p) => p.regra === regraSetor)).toBe(false);
      const cadastro = await porta.regras(ctx());
      expect(cadastro.regras.find((x) => x.id === regraSetor)).toMatchObject({
        ativo: false,
        setorNome: 'SETOR SINTETICO',
      });
    });

    it('o atendimento encerrado sem o documento do fechamento continua na lista do profissional', async () => {
      const encerrado = (n: string, situacao: string, alta: string, saida: string) =>
        nucleo.escrever({ cliente: CLIENTE, correlacao: `enc-${P}` }, (e) =>
          inserirMinimo(
            e,
            'atendimento',
            {
              estabelecimento_id: m.est,
              numero: `${P}-${n}`,
              paciente_id: m.pacienteB,
              categoria_atendimento_id: m.categoriaAt,
              carater_atendimento_tiss_id: m.caraterTiss,
              fonte_pagadora_id: m.fonte,
              profissional_id: m.profissional,
              situacao,
              desfecho: 'alta',
              entrada_em: new Date(new Date(alta).getTime() - 86_400_000),
              alta_medica_em: new Date(alta),
              saida_em: new Date(saida),
            },
            P,
          ),
        );
      const atC = await encerrado('C', 'encerrado', '2030-03-09T08:00:00.000Z', '2030-03-09T09:00:00.000Z');
      const atD = await encerrado('D', 'encerrado', '2029-12-01T08:00:00.000Z', '2029-12-01T09:00:00.000Z');
      const atE = await encerrado('E', 'cancelado', '2030-03-09T08:00:00.000Z', '2030-03-09T09:00:00.000Z');
      const r = await porta.incluir(ctx(), {
        modelo: m.modelo2,
        momento: 'fechamento_atendimento',
        exigencia: 'alertar',
        prazoMinutos: 120,
        vigenciaInicio: '2030-01-01',
      });
      const lista = await porta.pendencias(ctx(), {});
      const c = lista.itens.find((x) => x.atendimento === atC);
      expect(c?.pendencias).toEqual([
        expect.objectContaining({
          regra: Number(r['id']),
          momento: 'fechamento_atendimento',
          exigidoDesde: '2030-03-09T09:00:00.000Z',
          vencida: true,
        }),
      ]);
      // Os abertos ainda não fecharam: a regra do fechamento não pesa neles.
      const doFechamento = lista.itens.filter((x) => x.pendencias.some((p) => p.regra === Number(r['id'])));
      expect(doFechamento.map((x) => x.atendimento)).toEqual([atC]);
      expect(lista.itens.some((x) => x.atendimento === atD || x.atendimento === atE)).toBe(false);
      await porta.ativar(ctx(), Number(r['id']), { versao: 1, ativo: false });
    });

    it('a regra de todos os estabelecimentos guarda a origem e só ela a altera ou desativa', async () => {
      const base = {
        modelo: m.modelo1,
        momento: 'alta',
        exigencia: 'alertar',
        vigenciaInicio: '2030-01-01',
        todosEstabelecimentos: true,
      };
      const antes = await contar(
        'SELECT COUNT(*) AS n FROM regra_obrigatoriedade_documento WHERE estabelecimento_origem_id = ?',
        [m.est],
      );
      await expect(porta.incluir(ctx(), { ...base, setor: m.setor })).rejects.toMatchObject({
        problema: { status: 422 },
      });
      expect(
        await contar(
          'SELECT COUNT(*) AS n FROM regra_obrigatoriedade_documento WHERE estabelecimento_origem_id = ?',
          [m.est],
        ),
      ).toBe(antes);
      const g = Number((await porta.incluir(ctx(), base))['id']);
      const linha = async () =>
        (
          await ler(
            'SELECT estabelecimento_id, estabelecimento_origem_id, ativo, versao FROM regra_obrigatoriedade_documento WHERE id = ?',
            [g],
          )
        )[0];
      expect(await linha()).toMatchObject({
        estabelecimento_id: null,
        estabelecimento_origem_id: m.est,
        versao: 1,
      });
      const noOutro = await porta.regras(ctx(P2));
      expect(noOutro.regras.find((x) => x.id === g)).toMatchObject({
        todosEstabelecimentos: true,
        editavel: false,
      });
      expect((await porta.regras(ctx())).regras.find((x) => x.id === g)?.editavel).toBe(true);
      await expect(
        porta.alterar(ctx(P2), g, { ...base, versao: 1, todosEstabelecimentos: false }),
      ).rejects.toMatchObject({ problema: { status: 403 } });
      await expect(porta.ativar(ctx(P2), g, { versao: 1, ativo: false })).rejects.toMatchObject({
        problema: { status: 403 },
      });
      expect(await linha()).toMatchObject({ estabelecimento_id: null, versao: 1 });
      expect(Number((await linha())?.['ativo'])).toBe(1);
      await porta.ativar(ctx(), g, { versao: 1, ativo: false });
      expect(await linha()).toMatchObject({ estabelecimento_id: null, versao: 2 });
      expect(Number((await linha())?.['ativo'])).toBe(0);
    });

    it('a regra "bloquear" recusa o fechamento (executor) e a alta com o motivo, sem escrita; "alertar" deixa passar', async () => {
      // O executor usa o relógio real: atendimento aberto ontem e regra vigente desde 2026.
      const ontem = new Date(Date.now() - 86_400_000);
      const atF = await nucleo.escrever({ cliente: CLIENTE, correlacao: `bloq-${P}` }, (e) =>
        inserirMinimo(
          e,
          'atendimento',
          {
            estabelecimento_id: m.est,
            numero: `${P}-F`,
            paciente_id: m.pacienteB,
            categoria_atendimento_id: m.categoriaAt,
            carater_atendimento_tiss_id: m.caraterTiss,
            fonte_pagadora_id: m.fonte,
            profissional_id: m.profissional,
            situacao: 'aberto',
            entrada_em: ontem,
          },
          P,
        ),
      );
      const r = await porta.incluir(ctx(), {
        modelo: m.modelo1,
        momento: 'fechamento_atendimento',
        exigencia: 'bloquear',
        prazoMinutos: 120,
        vigenciaInicio: '2026-01-01',
      });
      const atd = new PortaAtendimentoPropria(nucleo, CLIENTE);
      const encerrar = () =>
        atd.executar(
          { cliente: CLIENTE, estabelecimento: m.est, usuario: m.usuario, correlacao: `${P}-atd` },
          'atendimento.encerrarAtendimento',
          { atendimento: atF, desfecho: 'evasao' },
          {
            ...ctx(),
            correlacao: `${P}-atd`,
            chaveIdempotencia: `${P}-${randomUUID()}`,
            login: 'teste.c2028',
            estacao: 'TESTE',
          },
        );
      const situacao = async () =>
        (await ler('SELECT situacao, saida_em FROM atendimento WHERE id = ?', [atF]))[0];
      await expect(encerrar()).rejects.toMatchObject({
        problema: {
          status: 422,
          codigo: 'documento-exigido-pendente',
          detail: expect.stringContaining('MODELO SINTETICO 1'),
        },
      });
      expect(await situacao()).toEqual({ situacao: 'aberto', saida_em: null });
      expect(
        await contar('SELECT COUNT(*) AS n FROM atendimento_situacao_historico WHERE atendimento_id = ?', [
          atF,
        ]),
      ).toBe(0);
      // A regra da alta recusa o passo da alta médica (a mesma conferência que a porta de ADT chama na transação).
      const rAlta = await porta.incluir(ctx(), {
        modelo: m.modelo2,
        momento: 'alta',
        exigencia: 'bloquear',
        prazoMinutos: 60,
        vigenciaInicio: '2026-01-01',
      });
      await expect(
        nucleo.escrever({ cliente: CLIENTE, correlacao: `alta-${P}` }, (e) =>
          conferirDocumentosExigidos(e, m.est, atF, ['alta'], new Date()),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'documento-exigido-pendente' } });
      await porta.ativar(ctx(), Number(rAlta['id']), { versao: 1, ativo: false });
      // Como "alertar", a mesma falta não recusa: o atendimento fecha.
      const [v] = await ler('SELECT versao FROM regra_obrigatoriedade_documento WHERE id = ?', [
        Number(r['id']),
      ]);
      await porta.alterar(ctx(), Number(r['id']), {
        versao: Number(v?.['versao']),
        modelo: m.modelo1,
        momento: 'fechamento_atendimento',
        exigencia: 'alertar',
        prazoMinutos: 120,
        vigenciaInicio: '2026-01-01',
      });
      await encerrar();
      expect((await situacao())?.['situacao']).toBe('encerrado');
      await porta.ativar(ctx(), Number(r['id']), { versao: Number(v?.['versao']) + 1, ativo: false });
    });
  },
);
