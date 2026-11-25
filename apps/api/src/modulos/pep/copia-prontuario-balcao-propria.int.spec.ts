// Contrato de efeito da cópia do prontuário no balcão e do cabeçalho da impressão por tipo de documento (F3, 03-PEP
// L131) contra o MariaDB real (cliente de teste). Massa SINTÉTICA com o código "c2036cp": dois estabelecimentos
// fictícios, um paciente fictício, dois arquivos sintéticos (autorização e procuração, só metadado) e um tipo de
// documento clínico sintético (nenhuma pessoa real). O usuário e o tipo de documento de identidade são ids já
// existentes do cliente de teste (só os ids são lidos).
// Prova o que fica no banco: o pedido do paciente numerado com o prazo de 15 dias; o pedido do familiar sem CPF
// recusado sem escrita; a autorização do familiar sem documento recusada e com ele gravada com quem autorizou; a
// versão velha recusada (409); a entrega antes da cópia pronta e a entrega a quem não tem vínculo recusadas sem
// escrita; a entrega com documento conferido e folhas gravada com quem entregou, o pedido entregue e a segunda
// entrega recusada; a visão por paciente com a entrega; a negativa com motivo; a regra de cabeçalho própria por tipo
// gravada, a repetida (409) e a inválida (422) recusadas, a prévia pela regra mais específica e, desativada (sem
// apagar), o padrão do estabelecimento; a sessão de outro estabelecimento recebe 404 sem escrita.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { inserirMinimo } from '../suprimentos/massa-propria.spec-util.js';
import { PortaCabecalhoImpressaoPropria } from './cabecalho-impressao-propria.js';
import { PortaCopiaProntuarioBalcaoPropria } from './copia-prontuario-balcao-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2036cp';
const P2 = `${P}b`;
const COD = (s: string) => `${P}${s}`.toUpperCase();
const AGORA = new Date('2030-03-10T15:00:00.000Z');
const CPF = '52998224725'; // CPF sintético de exemplo (dígitos válidos)

async function limpar(e: Escritor): Promise<void> {
  const ests = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
  await e.executar(`DELETE FROM entrega_copia_prontuario WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM solicitacao_copia_prontuario WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  const tipos = 'SELECT id FROM tipo_documento_clinico WHERE codigo = ?';
  await e.executar(
    `DELETE FROM cabecalho_impressao_documento WHERE estabelecimento_id IN (${ests}) OR tipo_documento_clinico_id IN (${tipos})`,
    [P, P2, COD('T')],
  );
  await e.executar('DELETE FROM tipo_documento_clinico WHERE codigo = ?', [COD('T')]);
  await e.executar('DELETE FROM arquivo WHERE chave_armazenamento LIKE ?', [`teste/${P}/%`]);
  const pf = 'SELECT id FROM pessoa_fisica WHERE nome LIKE ?';
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`% ${COD('')}`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('Cópia do prontuário no balcão e cabeçalho por tipo (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let copias: PortaCopiaProntuarioBalcaoPropria;
  let cabecalhos: PortaCabecalhoImpressaoPropria;
  let m: {
    usuario: number;
    est: number;
    paciente: number;
    tipoIdentidade: number;
    tipoDocumento: number;
    autorizacao: number;
    procuracao: number;
  };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const pedido = async (id: number) =>
    (await ler('SELECT * FROM solicitacao_copia_prontuario WHERE id = ?', [id]))[0] ?? {};
  const contar = async (tabela: string) =>
    Number(
      (
        await ler(
          `SELECT COUNT(*) AS n FROM ${tabela} t JOIN estabelecimento e ON e.id = t.estabelecimento_id WHERE e.codigo IN (?, ?)`,
          [P, P2],
        )
      )[0]?.['n'] ?? 0,
    );
  const base = {
    solicitanteNome: 'PACIENTE SINTETICO',
    motivo: 'Segunda opinião médica',
    periodoInicio: '2030-01-01',
    periodoFim: '2030-03-01',
  };
  let doPaciente = 0;
  let doFamiliar = 0;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const tipoIdentidade = await um(
        "SELECT MIN(id) AS id FROM tipo_documento_identificacao WHERE ativo AND aplica_a = 'pessoa_fisica'",
      );
      if (!usuario || !tipoIdentidade)
        throw new Error('O cliente de teste precisa de usuário e de tipo de documento de identidade.');
      const novoEst = (codigo: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, cnpj, fuso_horario, criado_em)
           VALUES (?, ?, ?, NULL, 'America/Sao_Paulo', ?)`,
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, new Date()],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const min = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, P);
      const pf = await min('pessoa_fisica', { nome: `PACIENTE SINTETICO ${COD('')}` });
      const paciente = await min('paciente', {
        pessoa_fisica_id: pf,
        situacao: 'ativo',
        numero_prontuario: 990_203_601,
      });
      const arquivo = (n: string) =>
        min('arquivo', {
          finalidade: 'anexo',
          nome_original: `${n}.pdf`,
          tipo_mime: 'application/pdf',
          tamanho_bytes: 1,
          hash_sha256: '0'.repeat(64),
          chave_armazenamento: `teste/${P}/${n}.pdf`,
        });
      const tipoDocumento = await min('tipo_documento_clinico', {
        codigo: COD('T'),
        descricao: 'TIPO SINTETICO',
        categoria: 'outro',
      });
      return {
        usuario,
        est,
        paciente,
        tipoIdentidade,
        tipoDocumento,
        autorizacao: await arquivo('autorizacao'),
        procuracao: await arquivo('procuracao'),
      };
    });
    copias = new PortaCopiaProntuarioBalcaoPropria(nucleo, CLIENTE, () => AGORA);
    cabecalhos = new PortaCabecalhoImpressaoPropria(nucleo, CLIENTE);
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('grava o pedido do paciente com número e prazo; o do familiar sem CPF é recusado sem escrita', async () => {
    const r = await copias.pedir(ctx(), { paciente: m.paciente, solicitanteTipo: 'paciente', ...base });
    doPaciente = Number(r['id']);
    const s = await pedido(doPaciente);
    expect(s).toMatchObject({
      situacao: 'solicitada',
      solicitante_tipo: 'paciente',
      formato_entrega: 'impresso',
    });
    expect(Number(s['numero'])).toBeGreaterThan(0);
    expect(String((s['prazo_entrega'] as Date).toISOString?.() ?? s['prazo_entrega']).slice(0, 10)).toBe(
      '2030-03-25',
    );
    await expect(
      copias.pedir(ctx(), {
        paciente: m.paciente,
        solicitanteTipo: 'familiar',
        solicitanteParentesco: 'Filha',
        ...base,
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await contar('solicitacao_copia_prontuario')).toBe(1);
    const f = await copias.pedir(ctx(), {
      paciente: m.paciente,
      solicitanteTipo: 'familiar',
      solicitanteCpf: '529.982.247-25',
      solicitanteParentesco: 'Filha',
      ...base,
      solicitanteNome: 'FAMILIAR SINTETICO',
    });
    doFamiliar = Number(f['id']);
    expect((await pedido(doFamiliar))['solicitante_cpf']).toBe(CPF);
  });

  it('autoriza o familiar só com a autorização digitalizada; versão velha é 409', async () => {
    await expect(copias.acao(ctx(), doFamiliar, { versao: 1, acao: 'autorizar' })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await copias.acao(ctx(), doFamiliar, { versao: 1, acao: 'autorizar', autorizacaoArquivo: m.autorizacao });
    const s = await pedido(doFamiliar);
    expect(s).toMatchObject({ situacao: 'autorizada', versao: 2 });
    expect(Number(s['autorizacao_arquivo_id'])).toBe(m.autorizacao);
    expect(Number(s['autorizador_usuario_id'])).toBe(m.usuario);
    await expect(copias.acao(ctx(), doFamiliar, { versao: 1, acao: 'pronta' })).rejects.toMatchObject({
      problema: { status: 409 },
    });
    await copias.acao(ctx(), doFamiliar, {
      versao: 2,
      acao: 'negar',
      motivo: 'Parentesco não comprovado',
    });
    expect(await pedido(doFamiliar)).toMatchObject({
      situacao: 'negada',
      motivo_negativa: 'Parentesco não comprovado',
    });
  });

  it('entrega só a cópia pronta, a quem tem vínculo, com documento e folhas; o pedido fica entregue', async () => {
    const entrega = (versao: number, extra: Record<string, unknown> = {}) =>
      copias.entregar(ctx(), doPaciente, {
        versao,
        recebedorNome: 'PACIENTE SINTETICO',
        vinculo: 'proprio_paciente',
        tipoDocumento: m.tipoIdentidade,
        numeroDocumento: '99887766',
        quantidadeFolhas: 12,
        ...extra,
      });
    await copias.acao(ctx(), doPaciente, { versao: 1, acao: 'autorizar' });
    await expect(entrega(2)).rejects.toMatchObject({ problema: { status: 422 } });
    await copias.acao(ctx(), doPaciente, { versao: 2, acao: 'pronta' });
    expect((await pedido(doPaciente))['impressa_em']).not.toBeNull();
    await expect(entrega(3, { vinculo: 'irmao', recebedorNome: 'IRMAO SINTETICO' })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect(await contar('entrega_copia_prontuario')).toBe(0);
    const r = await entrega(3);
    const [e] = await ler('SELECT * FROM entrega_copia_prontuario WHERE id = ?', [Number(r['id'])]);
    expect(e).toMatchObject({
      vinculo_com_paciente: 'proprio_paciente',
      numero_documento: '99887766',
      quantidade_folhas: 12,
      forma_entrega: 'presencial',
    });
    expect(Number(e?.['entregador_usuario_id'])).toBe(m.usuario);
    expect(Number(e?.['tipo_documento_identificacao_id'])).toBe(m.tipoIdentidade);
    const s = await pedido(doPaciente);
    expect(s['situacao']).toBe('entregue');
    expect(s['entregue_em']).not.toBeNull();
    await expect(entrega(4)).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await contar('entrega_copia_prontuario')).toBe(1);
  });

  it('visão por paciente com a entrega; a fila só com os abertos; outro estabelecimento não vê', async () => {
    const v = await copias.pedidos(ctx(), { paciente: String(m.paciente) });
    expect(v.pedidos.map((p) => p.situacao).sort()).toEqual(['entregue', 'negada']);
    const entregue = v.pedidos.find((p) => p.situacao === 'entregue');
    expect(entregue?.entrega).toMatchObject({ vinculo: 'proprio_paciente', quantidadeFolhas: 12 });
    expect(v.opcoes.tiposDocumento.length).toBeGreaterThan(0);
    expect((await copias.pedidos(ctx(), {})).pedidos).toHaveLength(0);
    expect((await copias.pedidos(ctx(P2), { paciente: String(m.paciente) })).pedidos).toHaveLength(0);
    await expect(
      copias.acao(ctx(P2), doPaciente, { versao: 4, acao: 'cancelar', motivo: 'Teste' }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
  });

  it('cabeçalho por tipo: grava, recusa repetida e inválida, prévia pela mais específica e desativa sem apagar', async () => {
    const padrao = await cabecalhos.incluir(ctx(), { fonte: 'estabelecimento', rodape: 'Rodapé padrão' });
    const proprio = await cabecalhos.incluir(ctx(), {
      tipoDocumento: m.tipoDocumento,
      fonte: 'personalizado',
      cabecalho: 'HOSPITAL SINTETICO\nAla de documentos',
      exibeAssinatura: false,
    });
    await expect(
      cabecalhos.incluir(ctx(), { tipoDocumento: m.tipoDocumento, fonte: 'estabelecimento' }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(
      cabecalhos.incluir(ctx(), { fonte: 'personalizado', cabecalho: '<b>x</b>' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await contar('cabecalho_impressao_documento')).toBe(2);
    const previa = await cabecalhos.previa(ctx(), { tipoDocumento: String(m.tipoDocumento) });
    expect(previa).toMatchObject({
      regra: Number(proprio['id']),
      linhas: ['HOSPITAL SINTETICO', 'Ala de documentos'],
      exibeAssinatura: false,
    });
    await cabecalhos.ativar(ctx(), Number(proprio['id']), { versao: 1, ativo: false });
    const depois = await cabecalhos.previa(ctx(), { tipoDocumento: String(m.tipoDocumento) });
    expect(depois.regra).toBe(Number(padrao['id']));
    expect(depois.linhas[0]).toBe(`Hospital sintético ${P}`);
    expect(depois.rodape).toEqual(['Rodapé padrão']);
    expect(await contar('cabecalho_impressao_documento')).toBe(2);
    await expect(
      cabecalhos.alterar(ctx(P2), Number(padrao['id']), { versao: 1, fonte: 'estabelecimento' }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    const r = await cabecalhos.regras(ctx());
    expect(r.regras.map((x) => x.ativo).sort()).toEqual([false, true]);
  });
});
