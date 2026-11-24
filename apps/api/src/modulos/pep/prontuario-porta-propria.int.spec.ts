// Integração da porta própria do prontuário contra o MariaDB real (cliente de teste f22_o1). Massa SINTÉTICA com
// códigos do lote (prefixo l0124p), montada no beforeAll e apagada no afterAll; nenhum dado de pessoa real. Prova o
// caminho que o dono abriu ("Registros do paciente"): lista, abertura, abas de texto e respostas e busca por palavra
// pelo próprio ServicoProntuario, sobre registros gravados pelo sistema e importados (origem 'migracao'), e o
// registro de acessos sobre a trilha gravada pelo RegistradorTrilhaPropria. O estabelecimento e o usuário do lote
// ficam (a trilha é só inclusão e os referencia); o resto é refeito a cada rodada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaPropria } from '../../autorizacao/trilha-propria.js';
import type { PortaCadastro } from '../cadastro/porta.js';
import { PortaProntuarioPropria } from './prontuario-porta-propria.js';
import { ServicoProntuario } from './servico.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l0124p';
const M = P.toUpperCase();
const C = {
  rede: CLIENTE,
  hospital: P,
  cliente: CLIENTE,
  estabelecimento: null,
  usuario: null,
  correlacao: P,
};
/** Número de prontuário sintético do lote (fora da faixa de qualquer carga). */
const PRONTUARIO = 901_240_101;

interface Massa {
  paciente: number;
  modelo: number;
  profissional: number;
  sistema: number;
  importado: number;
  semTexto: number;
  suspenso: number;
  confidencial: number;
  excluido: number;
  outroEstabelecimento: number;
  /** Sessão de psicologia importada sem a ocupação no registro: o CBO vem da inscrição do autor. */
  psicologia: number;
}

/** Códigos oficiais de ocupação (médico clínico, enfermeiro, psicólogo clínico); achados ou criados, nunca apagados. */
const CBO = { medico: '225125', enfermagem: '223505', psicologia: '251510' } as const;

describe.skipIf(SEM_BANCO)('PortaProntuarioPropria contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaProntuarioPropria;
  let servico: ServicoProntuario;
  let m: Massa;

  async function limpar(e: Escritor): Promise<void> {
    // Só linhas do lote; o estabelecimento P e o usuário leitor ficam (a trilha os referencia).
    const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
    const ests = [P, `${P}b`];
    const reg = `(SELECT id FROM registro_assistencial WHERE estabelecimento_id IN ${est})`;
    await e.executar(
      `DELETE FROM registro_assistencial_resposta WHERE registro_assistencial_id IN ${reg}`,
      ests,
    );
    await e.executar(
      `UPDATE registro_assistencial SET corrige_registro_assistencial_id = NULL WHERE estabelecimento_id IN ${est}`,
      ests,
    );
    await e.executar(`DELETE FROM registro_assistencial WHERE estabelecimento_id IN ${est}`, ests);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, ests);
    const modelos = `(SELECT id FROM modelo_documento_clinico WHERE codigo LIKE ?)`;
    const versoes = `(SELECT id FROM modelo_documento_versao WHERE modelo_documento_clinico_id IN ${modelos})`;
    await e.executar(
      `DELETE FROM modelo_campo_opcao WHERE modelo_campo_id IN (SELECT id FROM modelo_campo WHERE modelo_documento_versao_id IN ${versoes})`,
      [`${M}_%`],
    );
    await e.executar(`DELETE FROM modelo_campo WHERE modelo_documento_versao_id IN ${versoes}`, [`${M}_%`]);
    await e.executar(
      'UPDATE modelo_documento_clinico SET publicada_modelo_documento_versao_id = NULL, situacao = ? WHERE codigo LIKE ?',
      ['rascunho', `${M}_%`],
    );
    await e.executar(`DELETE FROM modelo_documento_versao WHERE modelo_documento_clinico_id IN ${modelos}`, [
      `${M}_%`,
    ]);
    await e.executar('DELETE FROM modelo_documento_clinico WHERE codigo LIKE ?', [`${M}_%`]);
    await e.executar('DELETE FROM tipo_documento_clinico WHERE codigo LIKE ?', [`${M}_%`]);
    await e.executar(
      'DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE ?)',
      [`Pessoa sintética ${P}%`],
    );
    const profs = '(SELECT id FROM profissional WHERE observacao = ?)';
    await e.executar(`DELETE FROM profissional_ocupacao WHERE profissional_id IN ${profs}`, [`massa ${P}`]);
    await e.executar(`DELETE FROM inscricao_conselho WHERE profissional_id IN ${profs}`, [`massa ${P}`]);
    await e.executar('DELETE FROM profissional WHERE observacao = ?', [`massa ${P}`]);
    await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`Pessoa sintética ${P}%`]);
    await e.executar('DELETE FROM categoria_atendimento WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM carater_atendimento_tiss WHERE codigo_tiss LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM usuario WHERE login = ?', [`${P}.autor`]);
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [`${P}b`]);
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, p);
      const achar = async (sql: string, p: unknown[], criar: () => Promise<number>) => {
        const x = await e.uma<{ id: unknown }>(sql, p);
        return x ? Number(x.id) : criar();
      };
      const estabelecimento = await achar('SELECT id FROM estabelecimento WHERE codigo = ?', [P], () =>
        ins(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
        ),
      );
      await e.executar('UPDATE estabelecimento SET fuso_horario = ? WHERE id = ?', [
        'America/Sao_Paulo',
        estabelecimento,
      ]);
      const outroEst = await ins(
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}b`, `Hospital sintético ${P}b`, `Hospital sintético ${P}b (fictício)`, agora],
      );
      await achar('SELECT id FROM usuario WHERE login = ?', [`${P}.leitor`], () =>
        ins('INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, ?, ?)', [
          `${P}.leitor`,
          'Conta sintética leitora',
          'servico',
          agora,
        ]),
      );
      const usuario = await ins(
        'INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}.autor`, 'Conta sintética autora', 'servico', agora],
      );
      const tipo = await ins(
        'INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
        [`${M}_EVOL`, 'Evolução sintética', 'evolucao', agora],
      );
      const modelo = await ins(
        `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, criado_em)
         VALUES (?, ?, ?, 'evolucao', ?)`,
        [`${M}_PUB`, 'Evolução sintética', tipo, agora],
      );
      const versao = await ins(
        `INSERT INTO modelo_documento_versao (modelo_documento_clinico_id, numero_versao, situacao, publicada_em,
           publicacao_usuario_id, hash_definicao, operacao, dados, ocorrido_em, usuario_id, criado_em)
         VALUES (?, 1, 'publicada', ?, ?, ?, 'inclusao', ?, ?, ?, ?)`,
        [modelo, agora, usuario, 'c'.repeat(64), '{"campos":[]}', agora, usuario, agora],
      );
      await e.executar(
        "UPDATE modelo_documento_clinico SET situacao = 'publicado', publicada_modelo_documento_versao_id = ? WHERE id = ?",
        [versao, modelo],
      );
      const campo = (seq: number, id: string, titulo: string, tipoCampo: string) =>
        ins(
          `INSERT INTO modelo_campo (modelo_documento_versao_id, sequencia, identificador, titulo, tipo_campo, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [versao, seq, id, titulo, tipoCampo, agora],
        );
      const campoQueixa = await campo(1, 'queixa', 'Queixa principal', 'texto');
      const campoDor = await campo(2, 'dor', 'Dor ao esforço', 'escolha');
      const campoTemp = await campo(3, 'temperatura', 'Temperatura', 'decimal');
      const opcaoSim = await ins(
        'INSERT INTO modelo_campo_opcao (modelo_campo_id, sequencia, codigo, rotulo, criado_em) VALUES (?, 1, ?, ?, ?)',
        [campoDor, 'sim', 'Sim', agora],
      );
      const pessoa = await ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        `Pessoa sintética ${P} paciente`,
        agora,
      ]);
      const pessoaProf = await ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        `Pessoa sintética ${P} profissional`,
        agora,
      ]);
      const paciente = await ins(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoa, PRONTUARIO, agora],
      );
      const profissional = await ins(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', ?, ?)",
        [pessoaProf, `massa ${P}`, agora],
      );
      const ocupacao: Record<keyof typeof CBO, number> = { medico: 0, enfermagem: 0, psicologia: 0 };
      for (const k of Object.keys(CBO) as (keyof typeof CBO)[])
        ocupacao[k] = await achar('SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?', [CBO[k]], () =>
          ins(
            'INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, criado_em) VALUES (?, ?, TRUE, ?)',
            [CBO[k], `Ocupação ${k} (sintética)`, agora],
          ),
        );
      // O médico tem a ocupação principal no cadastro; a psicóloga só a da inscrição no conselho (como na carga).
      await ins(
        'INSERT INTO profissional_ocupacao (profissional_id, ocupacao_cbo_id, principal, criado_em) VALUES (?, ?, TRUE, ?)',
        [profissional, ocupacao.medico, agora],
      );
      const pessoaPsi = await ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        `Pessoa sintética ${P} psicóloga`,
        agora,
      ]);
      const psicologa = await ins(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', ?, ?)",
        [pessoaPsi, `massa ${P}`, agora],
      );
      const conselho = await achar(
        'SELECT id FROM conselho_classe WHERE sigla = ? OR codigo_tiss = ? ORDER BY (sigla = ?) DESC LIMIT 1',
        ['LZPRT', 'Z5', 'LZPRT'],
        () =>
          ins('INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)', [
            'Z5',
            'LZPRT',
            `Conselho sintético do lote ${P}`,
            agora,
          ]),
      );
      const pais = await achar("SELECT id FROM pais_referencia WHERE codigo_iso = 'BR'", [], () =>
        ins("INSERT INTO pais_referencia (codigo_iso, descricao, criado_em) VALUES ('BR', 'Brasil', ?)", [
          agora,
        ]),
      );
      const uf = await achar("SELECT id FROM unidade_federativa WHERE sigla = 'RJ'", [], () =>
        ins(
          "INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES ('33', 'RJ', 'Rio de Janeiro', ?, ?)",
          [pais, agora],
        ),
      );
      await ins(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, criado_em) VALUES (?, 1, ?, ?, ?, ?, TRUE, ?)`,
        [psicologa, conselho, uf, '124001', ocupacao.psicologia, agora],
      );
      const categoria = await ins(
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [`${P}int`, 'Categoria sintética', agora],
      );
      const carater = await ins(
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}c`, 'Caráter sintético', 'teste', agora],
      );
      const fonte = await ins(
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [`${P}fp`, 'Fonte pagadora sintética', agora],
      );
      const atendimento = (est: number, numero: string) =>
        ins(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
          [
            est,
            numero,
            paciente,
            categoria,
            carater,
            fonte,
            profissional,
            new Date('2026-11-01T10:00:00Z'),
            agora,
          ],
        );
      const atend = await atendimento(estabelecimento, '7001');
      const atendOutro = await atendimento(outroEst, '7002');
      const registro = (
        est: number,
        at: number,
        clinica: string,
        extra: {
          texto?: string | null;
          origem?: string;
          confidencial?: boolean;
          excluido?: boolean;
          suspenso?: boolean;
          ocupacao?: number | null;
          autor?: number;
        } = {},
      ) =>
        ins(
          `INSERT INTO registro_assistencial (estabelecimento_id, paciente_id, atendimento_id, modelo_documento_clinico_id,
             tipo_documento_clinico_id, autor_profissional_id, autor_usuario_id, data_hora_clinica, data_hora_lancamento,
             impressao_digital, texto_consolidado, confidencial, origem, situacao, suspenso_em, suspenso_por_usuario_id,
             justificativa_suspensao, criado_em, excluido_em, ocupacao_cbo_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            est,
            paciente,
            at,
            modelo,
            tipo,
            extra.autor ?? profissional,
            usuario,
            new Date(clinica),
            new Date(clinica),
            '0'.repeat(64),
            extra.texto === undefined ? 'Paciente estável, sem dor torácica.' : extra.texto,
            extra.confidencial ?? false,
            extra.origem ?? 'sistema',
            extra.suspenso ? 'suspenso' : 'finalizado',
            extra.suspenso ? agora : null,
            extra.suspenso ? usuario : null,
            extra.suspenso ? `Lançado no paciente errado ${P}` : null,
            agora,
            extra.excluido ? agora : null,
            extra.ocupacao ?? null,
          ],
        );
      const sistema = await registro(estabelecimento, atend, '2026-11-10T12:30:00Z', {
        ocupacao: ocupacao.medico,
      });
      const importado = await registro(estabelecimento, atend, '2026-11-05T08:00:00Z', {
        origem: 'migracao',
        texto: "{\\rtf1\\ansi\\ansicpg1252 Evolu\\'e7\\'e3o importada: dor tor\\'e1cica leve\\par}",
      });
      const semTexto = await registro(estabelecimento, atend, '2026-10-20T15:00:00Z', {
        texto: null,
        ocupacao: ocupacao.enfermagem,
      });
      const suspenso = await registro(estabelecimento, atend, '2026-10-19T15:00:00Z', {
        suspenso: true,
        ocupacao: ocupacao.medico,
      });
      const psicologia = await registro(estabelecimento, atend, '2026-10-25T10:00:00Z', {
        origem: 'migracao',
        autor: psicologa,
        texto: 'Sessão de psicoterapia: relata dor emocional.',
      });
      const confidencial = await registro(estabelecimento, atend, '2026-11-11T09:00:00Z', {
        confidencial: true,
        texto: 'dor confidencial',
      });
      const excluido = await registro(estabelecimento, atend, '2026-11-12T09:00:00Z', {
        excluido: true,
        texto: 'dor excluída',
      });
      const outroEstabelecimento = await registro(outroEst, atendOutro, '2026-11-09T09:00:00Z', {
        texto: 'dor em outro hospital',
      });
      const resposta = (seq: number, campoId: number, tipoValor: string, cols: Record<string, unknown>) =>
        ins(
          `INSERT INTO registro_assistencial_resposta (registro_assistencial_id, sequencia, modelo_campo_id, tipo_valor,
             valor_texto, valor_numero, modelo_campo_opcao_id, unidade, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sistema,
            seq,
            campoId,
            tipoValor,
            cols['texto'] ?? null,
            cols['numero'] ?? null,
            cols['opcao'] ?? null,
            cols['unidade'] ?? null,
            agora,
          ],
        );
      await resposta(1, campoQueixa, 'texto', { texto: 'Dor torácica há 2 dias' });
      await resposta(2, campoDor, 'opcao', { opcao: opcaoSim });
      await resposta(3, campoTemp, 'numero', { numero: '36.8', unidade: '°C' });
      return {
        paciente,
        modelo,
        profissional,
        sistema,
        importado,
        semTexto,
        suspenso,
        confidencial,
        excluido,
        outroEstabelecimento,
        psicologia,
      };
    });
    porta = new PortaProntuarioPropria(nucleo, CLIENTE);
    const cadastro = {
      lerPacientes: async (_c: unknown, ids: readonly number[]) =>
        ids
          .filter((id) => id === m.paciente)
          .map((id) => ({
            id,
            prontuario: PRONTUARIO,
            nome: `Pessoa sintética ${P} paciente`,
            nomeSocial: null,
            nascimento: null,
            sexo: null,
            obito: null,
          })),
    } as unknown as PortaCadastro;
    servico = new ServicoProntuario(porta, cadastro, () => new Date('2026-11-23T12:00:00Z'));
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  }, 120_000);

  it('lista só os registros visíveis do estabelecimento, do mais recente, gravados e importados', async () => {
    const r = await porta.listar(C, m.paciente, {}, 1, 50);
    expect(r.registros.map((x) => x.id)).toEqual([
      m.sistema,
      m.importado,
      m.psicologia,
      m.semTexto,
      m.suspenso,
    ]);
    expect(r.haMais).toBe(false);
    expect(r.registros[0]).toMatchObject({
      dataHora: '2026-11-10T09:30:00',
      modelo: m.modelo,
      profissional: m.profissional,
    });
    expect(r.registros[4]?.justificativaSuspensao).toBe(`Lançado no paciente errado ${P}`);
    expect(r.fontes.get(m.semTexto)?.temConteudo).toBe(false);
    const pag = await porta.listar(C, m.paciente, {}, 2, 3);
    expect(pag.registros.map((x) => x.id)).toEqual([m.semTexto, m.suspenso]);
    const periodo = await porta.listar(C, m.paciente, { de: '2026-11-05', ate: '2026-11-05' }, 1, 50);
    expect(periodo.registros.map((x) => x.id)).toEqual([m.importado]);
  });

  it('CBO do registro: o da ocupação gravada e, no importado sem ela, o do autor no cadastro', async () => {
    const r = await porta.listar(C, m.paciente, {}, 1, 50);
    const cbo = new Map(r.registros.map((x) => [x.id, x.cbo]));
    expect(cbo.get(m.sistema)).toBe(CBO.medico);
    expect(cbo.get(m.semTexto)).toBe(CBO.enfermagem);
    // Importado sem ocupação no registro: a ocupação principal do médico e a da inscrição da psicóloga.
    expect(cbo.get(m.importado)).toBe(CBO.medico);
    expect(cbo.get(m.psicologia)).toBe(CBO.psicologia);
    const ids = async (f: { cboIncluir?: string[]; cboExcluir?: string[] }) =>
      (await porta.listar(C, m.paciente, f, 1, 50)).registros.map((x) => x.id);
    expect(await ids({ cboIncluir: ['2515'] })).toEqual([m.psicologia]);
    expect(await ids({ cboIncluir: ['225'] })).toEqual([m.sistema, m.importado, m.suspenso]);
    expect(await ids({ cboExcluir: ['225'] })).toEqual([m.psicologia, m.semTexto]);
    expect(await ids({ cboIncluir: ['2235', '3222'] })).toEqual([m.semTexto]);
    // Filtro por categoria do serviço (cadastro): o importado do médico entra pela ocupação do autor.
    const lista = await servico.lista(C, m.paciente, { pagina: 1, categoria: 'medico' } as never);
    expect(lista.itens.map((x) => x.id)).toEqual([m.sistema, m.importado, m.suspenso]);
    expect(lista.itens.find((x) => x.id === m.importado)).toMatchObject({
      profissional: { categoria: 'medico', cbo: CBO.medico },
    });
    const ctx = await porta.contexto(C, m.psicologia);
    expect(ctx?.cbo).toBe(CBO.psicologia);
  });

  it('sigilo por categoria (M23, regra 15): a sessão de psicologia importada fica só com a psicologia', async () => {
    const restrito = expect.objectContaining({ tipo: 'sem-permissao', status: 403 });
    for (const aba of ['texto', 'respostas'] as const)
      for (const leitor of ['medico', 'enfermagem', null] as const)
        await expect(
          servico.aba(C, m.paciente, m.psicologia, aba, { mostrarDocumentos: true, leitor }),
        ).rejects.toEqual(restrito);
    const aberto = await servico.abrir(C, m.paciente, m.psicologia, 'medico');
    expect(aberto.abas.texto.disponivel).toBe(false);
    const proprio = await servico.aba(C, m.paciente, m.psicologia, 'texto', {
      mostrarDocumentos: true,
      leitor: 'psicologia',
    });
    expect(JSON.stringify(proprio.conteudo)).toContain('psicoterapia');
    expect((await servico.buscar(C, m.paciente, { termo: 'emocional' } as never, 'medico')).itens).toEqual(
      [],
    );
    expect((await servico.buscar(C, m.paciente, { termo: 'emocional' } as never)).itens).toEqual([]);
    const psi = await servico.buscar(C, m.paciente, { termo: 'emocional' } as never, 'psicologia');
    expect(psi.itens.map((x) => x.registro)).toEqual([m.psicologia]);
  });

  it('o serviço lista, abre e mostra texto e respostas (caminho do dono)', async () => {
    const lista = await servico.lista(C, m.paciente, { pagina: 1 } as never);
    expect(lista.itens.map((x) => x.id)).toEqual([
      m.sistema,
      m.importado,
      m.psicologia,
      m.semTexto,
      m.suspenso,
    ]);
    expect(lista.excecoes.semConteudo).toBe(1);
    expect(lista.modelos.map((x) => x.id)).toEqual([m.modelo]);
    const aberto = await servico.abrir(C, m.paciente, m.importado);
    expect(aberto.abas.texto.disponivel).toBe(true);
    const texto = await servico.aba(C, m.paciente, m.importado, 'texto', { mostrarDocumentos: true });
    expect(JSON.stringify(texto.conteudo)).toContain('Evolução importada: dor torácica leve');
    const respostas = await servico.aba(C, m.paciente, m.sistema, 'respostas', { mostrarDocumentos: true });
    const corpo = JSON.stringify(respostas.conteudo);
    expect(corpo).toContain('Queixa principal');
    expect(corpo).toContain('Dor torácica há 2 dias');
    expect(corpo).toContain('Sim');
    expect(corpo).toContain('36,8');
    const contexto = await servico.aba(C, m.paciente, m.sistema, 'contexto', { mostrarDocumentos: true });
    expect(contexto.conteudo).toMatchObject({ atendimento: { numero: 7001 } });
    // Confidencial, excluído e de outro estabelecimento: "não encontrado" de domínio (404), nunca erro de SQL ou 500.
    const naoEncontrado = expect.objectContaining({ tipo: 'nao-encontrado', status: 404 });
    for (const id of [m.confidencial, m.outroEstabelecimento, m.excluido]) {
      expect(await porta.registro(C, m.paciente, id)).toBeNull();
      await expect(servico.abrir(C, m.paciente, id)).rejects.toEqual(naoEncontrado);
      await expect(servico.aba(C, m.paciente, id, 'texto', { mostrarDocumentos: true })).rejects.toEqual(
        naoEncontrado,
      );
    }
  });

  it('busca por palavra acha o registro gravado e o importado, nunca o confidencial, excluído ou de outro hospital', async () => {
    const r = await servico.buscar(C, m.paciente, { termo: 'dor' } as never);
    expect(r.itens.map((x) => x.registro).sort()).toEqual([m.sistema, m.importado, m.suspenso].sort());
    expect(r.truncado).toBe(false);
  });

  it('exceções agregadas contam o registro sem texto do lote', async () => {
    const e = await porta.excecoes(C);
    expect(e.filter((x) => x.modelo === m.modelo)).toEqual([
      {
        tipo: 'sem-conteudo',
        modelo: m.modelo,
        codigo: `${M}_PUB`,
        nome: 'Evolução sintética',
        mes: '2026-10',
        registros: 1,
      },
    ]);
  });

  it('acessos: a leitura gravada pela trilha própria aparece, filtrada pelo paciente', async () => {
    await new RegistradorTrilhaPropria(nucleo, CLIENTE).registrar({
      evento: 'pep.prontuario.lido',
      rede: CLIENTE,
      hospital: P,
      usuario: `${P}.leitor`,
      estacao: 'ESTACAO:teste',
      correlacao: `${P}-acesso`,
      recurso: 'pep.prontuario',
      resultado: 'sucesso',
      paciente: m.paciente,
    });
    const r = await porta.acessos(C, { paciente: m.paciente }, 1, 10);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({
      usuario: `${P}.leitor`,
      evento: 'pep.prontuario.lido',
      paciente: m.paciente,
      resultado: 'sucesso',
      origem: null,
    });
    expect((await porta.acessos(C, { paciente: m.paciente, soAlertas: true }, 1, 10)).itens).toEqual([]);
  });
});
