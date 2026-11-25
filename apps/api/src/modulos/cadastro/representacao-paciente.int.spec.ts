// Contrato de efeito da representação do paciente (F3.1, 02-CAD linha 4) contra o MariaDB real, no cliente de teste
// f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real): a condição de incapacidade (o
// que fica no banco, o levantamento que não apaga), a pendência do incapaz sem curador, o comprovante enviado pela
// porta de arquivos (disco temporário do teste), quem assina o consentimento do menor e do incapaz e o aviso da
// abertura do atendimento. A massa sai no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarArmazemLocal, type NucleoArmazem, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ArquivosDoModulo } from '../arquivos-locais.js';
import { PortaAtendimentoPropria } from '../atendimento/porta-propria.js';
import { FichaComplementarPropria } from './ficha-complementar-proprio.js';
import {
  CEP_TESTE,
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { CadastroProprioConsentimento, TIPO_TERMO_BALCAO } from './porta-propria-consentimento.js';
import { PortaCadastroPropria } from './porta-propria.js';
import { FINALIDADE_COMPROVANTE, RepresentacaoPacientePropria } from './representacao-paciente-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

const NOME = `REPR ${MARCA}`;
const CPF_ADULTO = cpfSintetico('990102321');
const CPF_MENOR = cpfSintetico('990102322');
const CPF_CURADOR = cpfSintetico('990102323');
const CPF_MAE = cpfSintetico('990102324');
const CPF_IRMA = cpfSintetico('990102325');
const CPF_OUTRO = cpfSintetico('990102326');

/** Um PDF sintético mínimo (só o cabeçalho e um corpo de texto fixo; nenhum dado de pessoa). */
const PDF = new Uint8Array(
  Buffer.from('%PDF-1.4\n% comprovante sintetico do teste F3.1-02\n%%EOF\n', 'latin1'),
);

async function limparRepresentacao(nucleo: NucleoProprio): Promise<void> {
  const pacientes = `SELECT id FROM (SELECT p.id FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
                      WHERE pf.nome LIKE ?) x`;
  const marca = [`%${NOME}%`];
  await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-repr-limpa' }, async (e) => {
    await e.executar(
      `DELETE h FROM consentimento_titular_historico h JOIN consentimento_titular k ON k.id = h.consentimento_titular_id
        WHERE k.paciente_id IN (${pacientes})`,
      marca,
    );
    await e.executar(`DELETE FROM consentimento_titular WHERE paciente_id IN (${pacientes})`, marca);
    await e.executar(`DELETE FROM incapacidade_paciente WHERE paciente_id IN (${pacientes})`, marca);
    await e.executar(`DELETE FROM responsavel_paciente WHERE paciente_id IN (${pacientes})`, marca);
    await e.executar(
      `DELETE FROM arquivo WHERE finalidade = ? AND entidade = 'paciente' AND entidade_id IN (${pacientes})`,
      [FINALIDADE_COMPROVANTE, ...marca],
    );
  });
}

describe.skipIf(SEM_BANCO)('representação do paciente no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let ficha: FichaComplementarPropria;
  let repr: RepresentacaoPacientePropria;
  let termos: CadastroProprioConsentimento;
  let m: Massa | null = null;
  let raiz = '';
  let adulto = 0;
  let menor = 0;
  let outro = 0;
  let curador = 0;
  let incapacidade = 0;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-repr-conta' }, (l) => l.uma<T>(sql, p));
  const contar = async (sql: string, p: readonly unknown[]) => Number((await um(sql, p))?.['n'] ?? -1);
  const trilha = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.representacao-paciente' },
    correlacao: 'f22-0102-repr',
  });
  const c = () => contextoPorta(m!, 'f22-0102-repr');
  const codigo = async (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'gravou',
      (x: { problema?: { codigo?: string }; codigo?: string; tipo?: string }) =>
        x.problema?.codigo ?? x.codigo ?? x.tipo ?? String(x),
    );
  const responsavel = (paciente: number, cpf: string, papel: string, nome: string) =>
    ficha.incluirResponsavel(
      c(),
      {
        paciente,
        cpf,
        nome: `${nome} ${NOME}`,
        nascimento: '1975-01-01',
        papel: papel as never,
        parentesco: null,
        autorizarProcedimento: papel !== 'familiar',
        receberInformacao: true,
        retirarDocumento: false,
        contatoPrincipal: false,
        prioridadeContato: null,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        comprovante: null,
        observacao: null,
      },
      trilha('responsavel_paciente'),
    );
  const pendencias = async (paciente: number) =>
    (await ficha.responsaveis(c(), paciente)).pendencias.map((p) => p.pendencia);
  const termo = (paciente: number, signatario: number) =>
    termos.registrarConsentimento(
      c(),
      {
        idPaciente: paciente,
        pront: 0,
        usuario: 'X',
        finalidade: 'Tratamento',
        versao: 'v1',
        situacao: 3,
        signatario,
      },
      trilha('consentimento_titular'),
    );
  const base = {
    inicio: '2025-02-10',
    documentoTipo: 'sentenca_curatela',
    documentoNumero: '0000000-00.2025.0.00.0000',
    documentoData: '2025-02-10',
    comprovante: null,
    observacao: null,
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE_F22)).banco).toBe(`cliente_${CLIENTE_F22}`);
    m = await prepararMassa(nucleo);
    await limparRepresentacao(nucleo);
    await limparMassa(nucleo, m);
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-repr-termo' }, async (e) => {
      const x = await e.uma('SELECT id FROM tipo_termo_lgpd WHERE codigo = ?', [TIPO_TERMO_BALCAO]);
      if (!x)
        await e.inserir(
          "INSERT INTO tipo_termo_lgpd (codigo, descricao, ativo, finalidade, criado_em) VALUES (?, 'CONSENTIMENTO NO BALCAO', TRUE, 'consentimento', ?)",
          [TIPO_TERMO_BALCAO, new Date()],
        );
    });
    const cadastro = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const paciente = async (nome: string, nascimento: string, cpf: string) =>
      (
        await cadastro.cadastrar(
          contextoPorta(m!),
          {
            nome,
            nascimento,
            sexo: 'F',
            cpf,
            naturalidade: 'BELO HORIZONTE',
            ufNaturalidade: 'MG',
            cep: CEP_TESTE,
            numero: 10,
          },
          contextoGravacao(m!),
        )
      ).resultado.idPaciente;
    adulto = await paciente(`ADULTO ${NOME}`, '1980-05-17', CPF_ADULTO);
    menor = await paciente(`MENOR ${NOME}`, '2016-03-02', CPF_MENOR);
    outro = await paciente(`OUTRO ${NOME}`, '1990-09-09', CPF_OUTRO);
    ficha = new FichaComplementarPropria(nucleo, CLIENTE_F22);
    termos = new CadastroProprioConsentimento(nucleo, CLIENTE_F22);
    // A porta de arquivos do teste: o armazém local do núcleo numa pasta temporária (o metadado vai para o MariaDB).
    raiz = mkdtempSync(join(tmpdir(), 'f3102-repr-'));
    const armazem = criarArmazemLocal(nucleo as unknown as NucleoArmazem, {
      raiz,
      executor: nucleo.criarExecutor(),
    });
    let n = 0;
    const fora = () => Promise.reject(new Error('fora do teste'));
    const arquivos: ArquivosDoModulo = {
      async guardar(_hospital, e) {
        const g = await armazem.guardar(e, {
          cliente: CLIENTE_F22,
          estabelecimento: m!.estabelecimento,
          usuario: m!.usuario,
          correlacao: 'f22-0102-repr-arq',
          chaveIdempotencia: `f22-0102-repr-arq-${Date.now()}-${++n}`,
        });
        return { id: g.id, hash: g.hash, reaproveitado: g.reaproveitado };
      },
      metadado: fora,
      async ler(_hospital, id) {
        const r = await armazem.ler(
          {
            cliente: CLIENTE_F22,
            estabelecimento: m!.estabelecimento,
            usuario: m!.usuario,
            correlacao: 'f22-0102-repr-arq-ler',
          },
          id,
        );
        return { metadado: r.metadado, conteudo: r.conteudo };
      },
      excluir: fora,
      fixarRetencao: fora,
    };
    repr = new RepresentacaoPacientePropria(nucleo, CLIENTE_F22, undefined, arquivos);
  }, 180_000);

  afterAll(async () => {
    await limparRepresentacao(nucleo).catch(() => undefined);
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
    if (raiz) rmSync(raiz, { recursive: true, force: true });
  });

  it('incapacidade: registro com data e documento, uma só vigente, pendência do incapaz sem curador', async () => {
    expect(await pendencias(adulto)).toEqual([]);
    expect(
      await codigo(
        repr.registrarIncapacidade(c(), { ...base, paciente: adulto, inicio: '2999-01-01' }, trilha('x')),
      ),
    ).toBe('incapacidade-invalida');
    expect(
      await codigo(
        repr.registrarIncapacidade(c(), { ...base, paciente: adulto, inicio: '1979-01-01' }, trilha('x')),
      ),
    ).toBe('incapacidade-invalida');
    expect(
      await codigo(
        repr.registrarIncapacidade(c(), { ...base, paciente: adulto, documentoNumero: null }, trilha('x')),
      ),
    ).toBe('incapacidade-invalida');
    expect(
      await codigo(
        repr.registrarIncapacidade(
          c(),
          { ...base, paciente: adulto, documentoTipo: 'declaracao' },
          trilha('x'),
        ),
      ),
    ).toBe('incapacidade-invalida');
    expect(
      await contar('SELECT COUNT(*) AS n FROM incapacidade_paciente WHERE paciente_id = ?', [adulto]),
    ).toBe(0);

    incapacidade = await repr.registrarIncapacidade(
      c(),
      { ...base, paciente: adulto },
      trilha('incapacidade_paciente'),
    );
    const linha = await um(
      `SELECT paciente_id, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio, vigencia_fim, documento_tipo,
              documento_numero, DATE_FORMAT(documento_data, '%Y-%m-%d') AS doc, comprovante_arquivo_id, paciente_vigente,
              criado_por, versao
         FROM incapacidade_paciente WHERE id = ?`,
      [incapacidade],
    );
    expect(linha).toMatchObject({
      inicio: '2025-02-10',
      vigencia_fim: null,
      documento_tipo: 'sentenca_curatela',
      documento_numero: '0000000-00.2025.0.00.0000',
      doc: '2025-02-10',
      comprovante_arquivo_id: null,
      versao: 1,
    });
    expect(Number(linha?.['paciente_id'])).toBe(adulto);
    expect(Number(linha?.['paciente_vigente'])).toBe(adulto);
    expect(Number(linha?.['criado_por'])).toBe(m!.usuario);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'incapacidade_paciente' AND entidade_id = ?",
        [incapacidade],
      ),
    ).toBe(1);
    // Uma só condição vigente por paciente (regra do domínio; o índice único do banco é a segunda barreira).
    expect(
      await codigo(
        repr.registrarIncapacidade(
          c(),
          { ...base, paciente: adulto, documentoTipo: 'laudo_medico' },
          trilha('x'),
        ),
      ),
    ).toBe('incapacidade-ja-vigente');
    expect(
      await contar('SELECT COUNT(*) AS n FROM incapacidade_paciente WHERE paciente_id = ?', [adulto]),
    ).toBe(1);

    // A pendência sai da condição, não de um curador cadastrado.
    expect(await pendencias(adulto)).toEqual(['incapaz-sem-curador']);
    const lida = await repr.incapacidades(c(), adulto);
    expect(lida.incapaz).toBe(true);
    expect(lida.itens).toHaveLength(1);
    expect(lida.itens[0]).toMatchObject({ id: incapacidade, vigente: true, temComprovante: false });
    expect(lida.alertas.map((a) => a.alerta)).toEqual(['incapaz-sem-curador']);
    // Familiar não é curador: a pendência continua.
    await responsavel(adulto, CPF_IRMA, 'familiar', 'IRMA');
    expect(await pendencias(adulto)).toEqual(['incapaz-sem-curador']);
    curador = await responsavel(adulto, CPF_CURADOR, 'curador', 'CURADOR');
    expect(await pendencias(adulto)).toEqual(['comprovante-ausente']);
    expect((await repr.incapacidades(c(), adulto)).alertas).toEqual([]);
  });

  it('comprovante pela porta de arquivos: metadado no banco, vínculo e incapacidade ligados, recusas', async () => {
    expect(
      await codigo(
        repr.enviarComprovante(
          c(),
          {
            paciente: adulto,
            alvo: 'responsavel',
            id: curador,
            conteudo: new Uint8Array(Buffer.from('texto qualquer, nao e documento')),
            nomeOriginal: 'termo.pdf',
          },
          trilha('responsavel_paciente'),
        ),
      ),
    ).toBe('arquivo-invalido');
    // O vínculo de outro paciente não recebe o arquivo (nada é guardado).
    expect(
      await codigo(
        repr.enviarComprovante(
          c(),
          { paciente: outro, alvo: 'responsavel', id: curador, conteudo: PDF, nomeOriginal: 'termo.pdf' },
          trilha('responsavel_paciente'),
        ),
      ),
    ).toBe('registro-inexistente');
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM arquivo WHERE finalidade = ? AND entidade = 'paciente' AND entidade_id IN (?, ?)",
        [FINALIDADE_COMPROVANTE, adulto, outro],
      ),
    ).toBe(0);

    const arq = await repr.enviarComprovante(
      c(),
      {
        paciente: adulto,
        alvo: 'responsavel',
        id: curador,
        conteudo: PDF,
        nomeOriginal: 'termo-curatela.pdf',
      },
      trilha('responsavel_paciente'),
    );
    const a = await um(
      'SELECT finalidade, entidade, entidade_id, tipo_mime, tamanho_bytes, estabelecimento_id FROM arquivo WHERE id = ?',
      [arq],
    );
    expect(a).toMatchObject({
      finalidade: FINALIDADE_COMPROVANTE,
      entidade: 'paciente',
      tipo_mime: 'application/pdf',
    });
    expect(Number(a?.['entidade_id'])).toBe(adulto);
    expect(Number(a?.['tamanho_bytes'])).toBe(PDF.length);
    const v = await um('SELECT comprovante_arquivo_id, versao FROM responsavel_paciente WHERE id = ?', [
      curador,
    ]);
    expect(Number(v?.['comprovante_arquivo_id'])).toBe(arq);
    expect(Number(v?.['versao'])).toBe(2);
    expect(await pendencias(adulto)).toEqual([]);

    // O mesmo caminho para o documento da incapacidade.
    const arq2 = await repr.enviarComprovante(
      c(),
      {
        paciente: adulto,
        alvo: 'incapacidade',
        id: incapacidade,
        conteudo: PDF,
        nomeOriginal: 'sentenca.pdf',
      },
      trilha('incapacidade_paciente'),
    );
    expect(
      Number(
        (await um('SELECT comprovante_arquivo_id FROM incapacidade_paciente WHERE id = ?', [incapacidade]))?.[
          'comprovante_arquivo_id'
        ],
      ),
    ).toBe(arq2);
    expect((await repr.incapacidades(c(), adulto)).itens[0]?.temComprovante).toBe(true);

    // Familiar não leva comprovante; o comprovante de um paciente não serve a outro.
    const irma = Number(
      (
        await um("SELECT id FROM responsavel_paciente WHERE paciente_id = ? AND papel = 'familiar'", [adulto])
      )?.['id'],
    );
    expect(
      await codigo(
        repr.enviarComprovante(
          c(),
          { paciente: adulto, alvo: 'responsavel', id: irma, conteudo: PDF, nomeOriginal: 'x.pdf' },
          trilha('responsavel_paciente'),
        ),
      ),
    ).toBe('papel-sem-comprovante');
    expect(
      (await um('SELECT comprovante_arquivo_id FROM responsavel_paciente WHERE id = ?', [irma]))?.[
        'comprovante_arquivo_id'
      ],
    ).toBeNull();
    expect(
      await codigo(
        repr.registrarIncapacidade(c(), { ...base, paciente: outro, comprovante: arq }, trilha('x')),
      ),
    ).toBe('arquivo-nao-e-comprovante');
    expect(
      await contar('SELECT COUNT(*) AS n FROM incapacidade_paciente WHERE paciente_id = ?', [outro]),
    ).toBe(0);

    // O comprovante anexado volta a ser aberto (a recepção confere o documento): o conteúdo e o tipo, pelo registro
    // do paciente da rota.
    const doCurador = await repr.lerComprovante(c(), { paciente: adulto, alvo: 'responsavel', id: curador });
    expect(doCurador).toMatchObject({ arquivo: arq, tipoMime: 'application/pdf' });
    expect(Buffer.from(PDF).equals(doCurador!.conteudo)).toBe(true);
    const daCondicao = await repr.lerComprovante(c(), {
      paciente: adulto,
      alvo: 'incapacidade',
      id: incapacidade,
    });
    expect(daCondicao?.tipoMime).toBe('application/pdf');
    expect(Buffer.from(PDF).equals(daCondicao!.conteudo)).toBe(true);
    // Registro de outro paciente, registro sem comprovante e registro inexistente: nada é devolvido.
    expect(await repr.lerComprovante(c(), { paciente: outro, alvo: 'responsavel', id: curador })).toBeNull();
    expect(
      await repr.lerComprovante(c(), { paciente: outro, alvo: 'incapacidade', id: incapacidade }),
    ).toBeNull();
    expect(await repr.lerComprovante(c(), { paciente: adulto, alvo: 'responsavel', id: irma })).toBeNull();
    expect(await repr.lerComprovante(c(), { paciente: adulto, alvo: 'incapacidade', id: 0 })).toBeNull();
    // Arquivo de outro paciente: mesmo que o vínculo aponte para ele (ligação feita por fora da regra), não abre.
    const guardiao = await responsavel(outro, CPF_MAE, 'guardiao_legal', 'MAE');
    const ligar = (arquivo: number | null) =>
      nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-repr-fora' }, (e) =>
        e.executar('UPDATE responsavel_paciente SET comprovante_arquivo_id = ? WHERE id = ?', [
          arquivo,
          guardiao,
        ]),
      );
    await ligar(arq);
    expect(await repr.lerComprovante(c(), { paciente: outro, alvo: 'responsavel', id: guardiao })).toBeNull();
    await ligar(null);
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-repr-fora' }, (e) =>
      e.executar('DELETE FROM responsavel_paciente WHERE id = ?', [guardiao]),
    );
  });

  it('consentimento: o menor e o incapaz não assinam; assina o representante que a regra escolhe', async () => {
    // Incapaz com curador: o próprio paciente é recusado; pelo representante, o termo fica com o vínculo do curador.
    expect(await codigo(termo(adulto, 1))).toBe('paciente-incapaz');
    const t1 = await termo(adulto, 2);
    const k1 = await um(
      'SELECT tipo_signatario, responsavel_paciente_id, situacao FROM consentimento_titular WHERE id = ?',
      [t1],
    );
    expect(k1).toMatchObject({ tipo_signatario: 'representante_legal', situacao: 'autorizado' });
    expect(Number(k1?.['responsavel_paciente_id'])).toBe(curador);
    // Menor sem representante: nem ele nem um representante inexistente; familiar não representa.
    expect(await codigo(termo(menor, 1))).toBe('paciente-menor');
    expect(await codigo(termo(menor, 2))).toBe('representante-ausente');
    await responsavel(menor, CPF_IRMA, 'familiar', 'IRMA');
    expect(await codigo(termo(menor, 2))).toBe('representante-ausente');
    expect(
      await contar('SELECT COUNT(*) AS n FROM consentimento_titular WHERE paciente_id = ?', [menor]),
    ).toBe(0);
    const mae = await responsavel(menor, CPF_MAE, 'responsavel_legal', 'MAE');
    const t2 = await termo(menor, 2);
    expect(
      Number(
        (await um('SELECT responsavel_paciente_id FROM consentimento_titular WHERE id = ?', [t2]))?.[
          'responsavel_paciente_id'
        ],
      ),
    ).toBe(mae);
    // O adulto capaz continua assinando por si.
    const t3 = await termo(outro, 1);
    expect(
      (
        await um('SELECT tipo_signatario, responsavel_paciente_id FROM consentimento_titular WHERE id = ?', [
          t3,
        ])
      )?.['responsavel_paciente_id'],
    ).toBeNull();
  });

  it('levantamento: o curador não sai com a incapacidade vigente; o fim fica com data e motivo, nada apagado', async () => {
    const encerrar = (levantamentoCuratela: boolean) =>
      ficha.encerrarResponsavel(
        c(),
        { paciente: adulto, id: curador, levantamentoCuratela, motivo: 'Teste do encerramento' },
        trilha('responsavel_paciente'),
      );
    expect(await codigo(encerrar(true))).toBe('incapacidade-vigente');
    expect(
      (await um('SELECT vigencia_fim FROM responsavel_paciente WHERE id = ?', [curador]))?.['vigencia_fim'],
    ).toBeNull();
    expect(
      await codigo(
        repr.encerrarIncapacidade(
          c(),
          { paciente: adulto, id: incapacidade, fim: '2025-02-09', motivo: 'Sentença de levantamento' },
          trilha('incapacidade_paciente'),
        ),
      ),
    ).toBe('levantamento-invalido');
    expect(
      await codigo(
        repr.encerrarIncapacidade(
          c(),
          { paciente: outro, id: incapacidade, fim: '2026-01-15', motivo: 'Sentença de levantamento' },
          trilha('incapacidade_paciente'),
        ),
      ),
    ).toBe('incapacidade-inexistente');
    await repr.encerrarIncapacidade(
      c(),
      { paciente: adulto, id: incapacidade, fim: '2026-01-15', motivo: 'Sentença de levantamento' },
      trilha('incapacidade_paciente'),
    );
    const linha = await um(
      `SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, motivo_encerramento, paciente_vigente, excluido_em, versao,
              comprovante_arquivo_id FROM incapacidade_paciente WHERE id = ?`,
      [incapacidade],
    );
    expect(linha).toMatchObject({
      fim: '2026-01-15',
      motivo_encerramento: 'Sentença de levantamento',
      paciente_vigente: null,
      excluido_em: null,
    });
    expect(linha?.['comprovante_arquivo_id']).not.toBeNull();
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'incapacidade_paciente' AND entidade_id = ?",
        [incapacidade],
      ),
    ).toBeGreaterThanOrEqual(3);
    const lida = await repr.incapacidades(c(), adulto);
    expect(lida.incapaz).toBe(false);
    expect(lida.itens).toHaveLength(1);
    expect(lida.itens[0]).toMatchObject({ vigente: false, fim: '2026-01-15' });
    // Curador vigente sem a incapacidade registrada (o caso de toda curatela anterior ao registro da condição): o
    // paciente continua sem assinar por si, assina o curador, e a ficha e a abertura pedem o registro da condição.
    expect(await pendencias(adulto)).toEqual(['curatela-sem-incapacidade']);
    expect(await repr.alertasDaAbertura(c(), adulto)).toEqual(['curatela-sem-incapacidade']);
    const antes = await contar('SELECT COUNT(*) AS n FROM consentimento_titular WHERE paciente_id = ?', [
      adulto,
    ]);
    expect(await codigo(termo(adulto, 1))).toBe('paciente-incapaz');
    expect(
      await contar('SELECT COUNT(*) AS n FROM consentimento_titular WHERE paciente_id = ?', [adulto]),
    ).toBe(antes);
    const peloCurador = await termo(adulto, 2);
    expect(
      Number(
        (await um('SELECT responsavel_paciente_id FROM consentimento_titular WHERE id = ?', [peloCurador]))?.[
          'responsavel_paciente_id'
        ],
      ),
    ).toBe(curador);
    // Encerrada a curatela (com o levantamento declarado), o paciente volta a assinar por si.
    expect(await codigo(encerrar(false))).toBe('incapaz-sem-curador');
    expect(await codigo(encerrar(true))).toBe('gravou');
    expect(await pendencias(adulto)).toEqual([]);
    expect(await codigo(termo(adulto, 1))).toBe('gravou');
    // A condição encerrada não impede um novo registro (o histórico fica).
    await repr.registrarIncapacidade(
      c(),
      {
        ...base,
        paciente: adulto,
        inicio: '2026-03-01',
        documentoTipo: 'laudo_medico',
        documentoNumero: null,
      },
      trilha('incapacidade_paciente'),
    );
    expect(
      await contar('SELECT COUNT(*) AS n FROM incapacidade_paciente WHERE paciente_id = ?', [adulto]),
    ).toBe(2);
    expect(await pendencias(adulto)).toEqual(['incapaz-sem-curador']);
  });

  it('abertura do atendimento: avisa o incapaz sem curador e o menor sem representante, sem bloquear', async () => {
    const mm = m!;
    const atendimento = new PortaAtendimentoPropria(nucleo, CLIENTE_F22);
    const abrir = async (paciente: number) =>
      (
        await atendimento.executar(
          contextoPorta(mm),
          'atendimento.abrirAtendimento',
          {
            tipo: 'consulta',
            paciente,
            convenio: mm.fonte,
            matricula: '123456',
            profissional: mm.profissional,
            especialidade: mm.especialidade,
            unidade: mm.unidade,
            centroCusto: mm.centroCusto,
            procedimento: mm.procedimento,
            cidPrincipal: mm.cid,
            carater: 'eletivo',
            local: mm.local,
          },
          contextoGravacao(mm),
        )
      ).resultado;
    // O adulto está de novo incapaz e sem curador (fim do caso anterior).
    expect(await repr.alertasDaAbertura(c(), adulto)).toEqual(['incapaz-sem-curador']);
    const a = await abrir(adulto);
    expect(Number(a['reg'])).toBeGreaterThan(0);
    expect(a['alertaRepresentacao']).toBe('incapaz-sem-curador');
    expect(String(a['alertaRepresentacaoMotivo'])).toContain('curador');
    expect(
      await contar("SELECT COUNT(*) AS n FROM atendimento WHERE id = ? AND situacao = 'aberto'", [a['reg']]),
    ).toBe(1);
    // O menor já tem a responsável legal (caso do consentimento): nada a avisar. Sem ela, o aviso volta.
    const b = await abrir(menor);
    expect(b['alertaRepresentacao']).toBeUndefined();
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-repr-fim' }, (e) =>
      e.executar(
        "UPDATE responsavel_paciente SET vigencia_fim = CURRENT_DATE - INTERVAL 1 DAY WHERE paciente_id = ? AND papel = 'responsavel_legal'",
        [menor],
      ),
    );
    expect(await repr.alertasDaAbertura(c(), menor)).toEqual(['menor-sem-representante']);
    // O adulto capaz não tem aviso.
    const d = await abrir(outro);
    expect(d['alertaRepresentacao']).toBeUndefined();
  });
});
