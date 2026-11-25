// Contrato de efeito do C1-112 (09-AREA linha 74) contra o MariaDB real (cliente de teste), num estabelecimento
// SINTÉTICO. Atendimentos, internações, paciente, usuário e profissional são ids já existentes do cliente (só lidos); o
// resto é massa sintética apagada no fim. Prova o que fica no banco:
//   - funerária: inclusão com telefones só com dígitos, nome repetido recusado (409), alteração com versão (versão velha
//     recusada) e saída de uso sem apagar;
//   - declaração de óbito: funerária e cartório gravados na declaração; funerária fora de uso e cartório fora de uso
//     recusados sem gravar; a visão por paciente e o painel trazem o destino e as pendências;
//   - guarda do corpo: uma por atendimento, ligada à declaração e à internação, com a funerária da declaração; a troca da
//     funerária na declaração acompanha a guarda aberta; liberação recusada sem a entrega da declaração e, com ela,
//     gravada com o CPF só com dígitos, as conferências, o instante e o usuário; retirada antes da liberação recusada e
//     depois gravada; cancelamento recusado depois da retirada; a declaração em rascunho não libera e é encaminhada ao
//     serviço de verificação. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaDestinoCorpoPropria } from './destino-corpo-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c1112dc';

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  emitida: number;
  rascunho: number;
  atendimentoEmitida: number;
  internacaoEmitida: number;
  cartorio: number;
  cartorioInativo: number;
  parentesco: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const t of ['liberacao_corpo', 'declaracao_obito', 'servico_funerario'])
      await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM cartorio_registro_civil WHERE codigo LIKE ?', [`${P}%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaDestinoCorpoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaDestinoCorpoPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const uma = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0]!;
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return `${String(e)} ${JSON.stringify(e)}`;
    }
    throw new Error('era para recusar');
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const prof = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      const ints = await e.consultar(
        'SELECT id, atendimento_id, paciente_id FROM internacao WHERE excluido_em IS NULL ORDER BY id LIMIT 2',
      );
      const par = await e.uma('SELECT MIN(id) AS id FROM tipo_parentesco WHERE NOT proprio_paciente');
      if (!usuario?.['id'] || !prof?.['id'] || ints.length < 2 || !par?.['id'])
        throw new Error(
          'O cliente de teste precisa de usuário, profissional, duas internações e parentesco.',
        );
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const obitoEm = new Date(agora.getTime() - 3 * 3600_000);
      const declarar = (int: Record<string, unknown>, numero: string, situacao: 'emitida' | 'rascunho') =>
        e.inserir(
          `INSERT INTO declaracao_obito (estabelecimento_id, atendimento_id, paciente_id, numero, obito_em, profissional_id,
             situacao, emitida_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            est,
            Number(int['atendimento_id']),
            Number(int['paciente_id']),
            numero,
            obitoEm,
            Number(prof['id']),
            situacao,
            situacao === 'emitida' ? agora : null,
            agora,
          ],
        );
      const cartorio = (sufixo: string, ativo: boolean) =>
        e.inserir(
          'INSERT INTO cartorio_registro_civil (codigo, descricao, ativo, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}${sufixo}`, `Cartório sintético ${P}${sufixo}`, ativo, agora],
        );
      return {
        est,
        usuario: Number(usuario['id']),
        paciente: Number(ints[0]!['paciente_id']),
        emitida: await declarar(ints[0]!, '1120001', 'emitida'),
        rascunho: await declarar(ints[1]!, '1120002', 'rascunho'),
        atendimentoEmitida: Number(ints[0]!['atendimento_id']),
        internacaoEmitida: Number(ints[0]!['id']),
        cartorio: await cartorio('a', true),
        cartorioInativo: await cartorio('b', false),
        parentesco: Number(par['id']),
      };
    });
    porta = new PortaDestinoCorpoPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  let funeraria = 0;
  let funerariaFora = 0;

  it('funerária: inclusão normalizada, nome repetido, alteração com versão e saída de uso', async () => {
    funeraria = (
      await porta.incluirFuneraria(ctx(), {
        nome: ' Funerária   sintética A ',
        telefone: null,
        telefonePlantao: '(11) 99999-0001',
        email: 'plantao@exemplo.invalid',
        documentosExigidos: 'Contrato e documento do responsável',
        observacao: null,
      })
    ).id;
    const f = await uma('SELECT * FROM servico_funerario WHERE id = ?', [funeraria]);
    expect(f).toMatchObject({
      estabelecimento_id: m.est,
      nome: 'Funerária sintética A',
      telefone: null,
      telefone_plantao: '11999990001',
      origem: 'sistema',
      versao: 1,
    });
    expect(Boolean(f['ativo'])).toBe(true);
    expect(f['criado_por']).toBe(m.usuario);
    expect(
      await falha(porta.incluirFuneraria(ctx(), { nome: 'Funerária sintética A', telefone: '1133334444' })),
    ).toContain('nome-repetido');
    expect(await falha(porta.incluirFuneraria(ctx(), { nome: 'Sem telefone' }))).toContain('regra-violada');

    funerariaFora = (
      await porta.incluirFuneraria(ctx(), { nome: 'Funerária sintética B', telefone: '1133334444' })
    ).id;
    await porta.alterarFuneraria(ctx(), funerariaFora, {
      nome: 'Funerária sintética B',
      telefone: '11 3333-5555',
      versao: 1,
    });
    expect(
      await falha(
        porta.alterarFuneraria(ctx(), funerariaFora, { nome: 'Outra', telefone: '1133334444', versao: 1 }),
      ),
    ).toMatch(/vers|409|conflito/i);
    await porta.usoFuneraria(ctx(), funerariaFora, { ativo: false, versao: 2 });
    const b = await uma('SELECT telefone, ativo, versao, excluido_em FROM servico_funerario WHERE id = ?', [
      funerariaFora,
    ]);
    expect(b).toMatchObject({ telefone: '1133335555', versao: 3, excluido_em: null });
    expect(Boolean(b['ativo'])).toBe(false);
    expect((await porta.funerarias(ctx())).map((x) => x.id)).toEqual([funeraria]);
    expect((await porta.funerarias(ctx(), true)).map((x) => x.id)).toEqual([funeraria, funerariaFora]);
    const apoio = await porta.apoio(ctx());
    expect(apoio.funerarias.map((x) => x.id)).toEqual([funeraria]);
    expect(apoio.cartorios.some((x) => x.id === m.cartorio)).toBe(true);
    expect(apoio.cartorios.some((x) => x.id === m.cartorioInativo)).toBe(false);
  });

  it('declaração: funerária e cartório gravados; fora de uso recusado sem gravar; visão por paciente', async () => {
    expect(
      await falha(
        porta.definirDestino(ctx(), m.emitida, { funeraria: funerariaFora, cartorio: null, versao: 1 }),
      ),
    ).toContain('regra-violada');
    expect(
      await falha(
        porta.definirDestino(ctx(), m.emitida, { funeraria: null, cartorio: m.cartorioInativo, versao: 1 }),
      ),
    ).toContain('regra-violada');
    expect(await uma('SELECT versao FROM declaracao_obito WHERE id = ?', [m.emitida])).toMatchObject({
      versao: 1,
    });

    await porta.definirDestino(ctx(), m.emitida, { funeraria, cartorio: m.cartorio, versao: 1 });
    expect(
      await uma(
        'SELECT servico_funerario_id, cartorio_registro_civil_id, versao, alterado_por FROM declaracao_obito WHERE id = ?',
        [m.emitida],
      ),
    ).toEqual({
      servico_funerario_id: funeraria,
      cartorio_registro_civil_id: m.cartorio,
      versao: 2,
      alterado_por: m.usuario,
    });
    const v = await porta.obitoDoPaciente(ctx(), m.paciente);
    expect(v).toMatchObject({
      declaracao: m.emitida,
      situacao: 'emitida',
      funeraria: { id: funeraria, telefonePlantao: '11999990001' },
      cartorio: { id: m.cartorio },
      guarda: null,
      pendencias: ['guarda'],
    });
    const painel = await porta.obitos(ctx());
    expect(painel.map((x) => x.declaracao).sort()).toEqual([m.emitida, m.rascunho].sort());
  });

  it('guarda e liberação: abrir, acompanhar a funerária, liberar, retirar e não cancelar o retirado', async () => {
    const entrada = new Date(Date.now() - 2 * 3600_000).toISOString();
    const g = (
      await porta.abrirGuarda(ctx(), {
        declaracao: m.emitida,
        entradaNecroterio: entrada,
        localGuarda: 'Câmara 2',
      })
    ).id;
    expect(await uma('SELECT * FROM liberacao_corpo WHERE id = ?', [g])).toMatchObject({
      estabelecimento_id: m.est,
      paciente_id: m.paciente,
      atendimento_id: m.atendimentoEmitida,
      internacao_id: m.internacaoEmitida,
      declaracao_obito_id: m.emitida,
      servico_funerario_id: funeraria,
      local_guarda: 'Câmara 2',
      situacao: 'em_guarda',
      versao: 1,
    });
    expect(await falha(porta.abrirGuarda(ctx(), { declaracao: m.emitida }))).toContain('regra-violada');

    // A troca da funerária na declaração acompanha a guarda aberta.
    await porta.usoFuneraria(ctx(), funerariaFora, { ativo: true, versao: 3 });
    await porta.definirDestino(ctx(), m.emitida, {
      funeraria: funerariaFora,
      cartorio: m.cartorio,
      versao: 2,
    });
    expect(await uma('SELECT servico_funerario_id, versao FROM liberacao_corpo WHERE id = ?', [g])).toEqual({
      servico_funerario_id: funerariaFora,
      versao: 2,
    });

    const liberar = {
      acao: 'liberar',
      versao: 2,
      funeraria,
      retiranteNome: 'Pessoa sintética',
      retiranteCpf: '529.982.247-25',
      parentesco: m.parentesco,
      documentosConferidos: true,
      declaracaoEntregue: false,
      pertencesEntregues: true,
    };
    expect(await falha(porta.acaoGuarda(ctx(), g, liberar))).toContain('regra-violada');
    expect((await porta.acaoGuarda(ctx(), g, { ...liberar, declaracaoEntregue: true })).situacao).toBe(
      'liberado',
    );
    const lib = await uma('SELECT * FROM liberacao_corpo WHERE id = ?', [g]);
    expect(lib).toMatchObject({
      situacao: 'liberado',
      servico_funerario_id: funeraria,
      retirante_nome: 'Pessoa sintética',
      retirante_cpf: '52998224725',
      retirante_tipo_parentesco_id: m.parentesco,
      liberacao_usuario_id: m.usuario,
      versao: 3,
    });
    expect(
      [lib['documentos_conferidos'], lib['declaracao_obito_entregue'], lib['pertences_entregues']].map(
        Boolean,
      ),
    ).toEqual([true, true, true]);
    expect(lib['data_hora_liberacao']).not.toBeNull();

    const antes = new Date(Date.now() - 4 * 3600_000).toISOString();
    expect(
      await falha(porta.acaoGuarda(ctx(), g, { acao: 'retirar', versao: 3, retiradaEm: antes })),
    ).toContain('regra-violada');
    const agora = new Date().toISOString();
    expect(
      (await porta.acaoGuarda(ctx(), g, { acao: 'retirar', versao: 3, retiradaEm: agora })).situacao,
    ).toBe('retirado');
    expect(
      await uma('SELECT situacao, data_hora_retirada IS NOT NULL AS r FROM liberacao_corpo WHERE id = ?', [
        g,
      ]),
    ).toMatchObject({ situacao: 'retirado', r: 1 });
    expect(
      await falha(
        porta.acaoGuarda(ctx(), g, { acao: 'cancelar', versao: 4, motivo: 'Motivo sintético longo' }),
      ),
    ).toContain('regra-violada');
    const v = await porta.obitoDoPaciente(ctx(), m.paciente);
    expect(v?.guarda?.situacao).toBe('retirado');
    expect(v?.pendencias).toEqual([]);
  });

  it('declaração em rascunho: não libera; encaminha ao serviço de verificação; cancelamento com motivo', async () => {
    const g = (await porta.abrirGuarda(ctx(), { declaracao: m.rascunho })).id;
    expect(
      await falha(
        porta.acaoGuarda(ctx(), g, {
          acao: 'liberar',
          versao: 1,
          retiranteNome: 'Pessoa sintética',
          retiranteDocumento: 'RG sintético',
          documentosConferidos: true,
          declaracaoEntregue: true,
        }),
      ),
    ).toContain('regra-violada');
    await porta.acaoGuarda(ctx(), g, { acao: 'encaminhar_iml', versao: 1 });
    const r = await uma(
      'SELECT situacao, encaminhado_iml, versao, excluido_em FROM liberacao_corpo WHERE id = ?',
      [g],
    );
    expect(r).toMatchObject({ situacao: 'encaminhado_iml', versao: 2, excluido_em: null });
    expect(Boolean(r['encaminhado_iml'])).toBe(true);
    expect(
      await falha(porta.acaoGuarda(ctx(), g, { acao: 'cancelar', versao: 2, motivo: 'curto' })),
    ).toContain('regra-violada');
  });
});
