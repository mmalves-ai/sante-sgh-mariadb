// Contrato de efeito da foto do paciente para a identificação positiva (F3.1, 02-CAD linha 5) contra o MariaDB real,
// no cliente de teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real) e imagens
// sintéticas (só o cabeçalho JPEG e bytes fixos): a foto guardada pela porta de arquivos com o paciente como dono e a
// guarda do prontuário, a ligação ativa em `identificacao_biometrica`, a substituição que não apaga, a revogação com
// motivo e as conferências em `verificacao_biometrica` (confirmada pela foto, dispensada pelo documento, recusas).
// A massa sai no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardaFotoIdentificacaoAte } from '@sgh/dominio-cadastro';
import { criarArmazemLocal, type NucleoArmazem, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ArquivosDoModulo } from '../arquivos-locais.js';
import { FINALIDADE_FOTO_IDENTIFICACAO, FotoIdentificacaoPropria } from './foto-identificacao-propria.js';
import {
  CEP_TESTE,
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  limparMassa,
  type Massa,
  MARCA,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { PortaCadastroPropria } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

const NOME = `FOTOID ${MARCA}`;
/** JPEG sintético: o cabeçalho e um corpo fixo marcado pela semente (nenhum dado de pessoa). */
const jpeg = (semente: number) => {
  const b = new Uint8Array(64).fill(semente);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

async function limpar(nucleo: NucleoProprio): Promise<void> {
  const pacientes = `SELECT id FROM (SELECT p.id FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
                      WHERE pf.nome LIKE ?) x`;
  const pessoas = `SELECT id FROM (SELECT pf.id FROM pessoa_fisica pf WHERE pf.nome LIKE ?) y`;
  const marca = [`%${NOME}%`];
  await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-fotoid-limpa' }, async (e) => {
    await e.executar(`DELETE FROM verificacao_biometrica WHERE paciente_id IN (${pacientes})`, marca);
    await e.executar(`DELETE FROM identificacao_biometrica WHERE pessoa_fisica_id IN (${pessoas})`, marca);
    await e.executar(
      `DELETE FROM arquivo WHERE finalidade = ? AND entidade = 'paciente' AND entidade_id IN (${pacientes})`,
      [FINALIDADE_FOTO_IDENTIFICACAO, ...marca],
    );
  });
}

describe.skipIf(SEM_BANCO)('foto do paciente para a identificação positiva (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let fotos: FotoIdentificacaoPropria;
  let m: Massa | null = null;
  let raiz = '';
  let paciente = 0;
  let semFoto = 0;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-fotoid-conta' }, (l) => l.uma<T>(sql, p));
  const trilha = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.foto-identificacao' },
    correlacao: 'f22-0102-fotoid',
  });
  const c = () => contextoPorta(m!, 'f22-0102-fotoid');
  const codigo = async (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'gravou',
      (x: { problema?: { codigo?: string }; codigo?: string }) => x.problema?.codigo ?? x.codigo ?? String(x),
    );
  const conferir = (
    pac: number,
    resultado: string,
    motivoDispensa: string | null = null,
    atendimento: number | null = null,
  ) =>
    fotos.conferir(
      c(),
      { paciente: pac, resultado, contexto: 'recepcao', motivoDispensa, atendimento },
      trilha('verificacao_biometrica'),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE_F22)).banco).toBe(`cliente_${CLIENTE_F22}`);
    m = await prepararMassa(nucleo);
    await limpar(nucleo);
    await limparMassa(nucleo, m);
    const cadastro = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const novo = async (nome: string, cpf: string) =>
      (
        await cadastro.cadastrar(
          contextoPorta(m!),
          {
            nome,
            nascimento: '1981-04-12',
            sexo: 'M',
            cpf,
            naturalidade: 'BELO HORIZONTE',
            ufNaturalidade: 'MG',
            cep: CEP_TESTE,
            numero: 10,
          },
          contextoGravacao(m!),
        )
      ).resultado.idPaciente;
    paciente = await novo(`COM FOTO ${NOME}`, cpfSintetico('990102331'));
    semFoto = await novo(`SEM FOTO ${NOME}`, cpfSintetico('990102332'));
    raiz = mkdtempSync(join(tmpdir(), 'f3102-fotoid-'));
    const armazem = criarArmazemLocal(nucleo as unknown as NucleoArmazem, {
      raiz,
      executor: nucleo.criarExecutor(),
    });
    let n = 0;
    const fora = () => Promise.reject(new Error('fora do teste'));
    const ctxArq = () => ({
      cliente: CLIENTE_F22,
      estabelecimento: m!.estabelecimento,
      usuario: m!.usuario,
      correlacao: 'f22-0102-fotoid-arq',
    });
    const arquivos: ArquivosDoModulo = {
      async guardar(_h, e) {
        const g = await armazem.guardar(e, {
          ...ctxArq(),
          chaveIdempotencia: `f22-0102-fotoid-arq-${Date.now()}-${++n}`,
        });
        return { id: g.id, hash: g.hash, reaproveitado: g.reaproveitado };
      },
      metadado: fora,
      async ler(_h, id) {
        const r = await armazem.ler(ctxArq(), id);
        return { metadado: r.metadado, conteudo: r.conteudo };
      },
      excluir: fora,
      fixarRetencao: fora,
    };
    fotos = new FotoIdentificacaoPropria(nucleo, CLIENTE_F22, undefined, arquivos);
  });

  afterAll(async () => {
    await limpar(nucleo).catch(() => undefined);
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
    if (raiz) rmSync(raiz, { recursive: true, force: true });
  });

  it('captura: arquivo do paciente com a guarda do prontuário e a ligação ativa', async () => {
    expect(
      await codigo(
        fotos.cadastrarFoto(
          c(),
          { paciente, conteudo: new Uint8Array(Buffer.from('%PDF-1.4 x')) },
          trilha('x'),
        ),
      ),
    ).toBe('foto-invalida');
    const id = await fotos.cadastrarFoto(
      c(),
      { paciente, conteudo: jpeg(1) },
      trilha('identificacao_biometrica'),
    );
    const r = await um(
      `SELECT ib.modalidade, ib.situacao, ib.captura_estabelecimento_id AS est, ib.capturado_por_usuario_id AS usu,
              ib.versao, t.codigo AS tipo, a.finalidade, a.entidade, a.entidade_id, a.retencao_ate, a.tipo_mime
         FROM identificacao_biometrica ib JOIN arquivo a ON a.id = ib.arquivo_id
         JOIN tipo_autenticacao_biometrica t ON t.id = ib.tipo_autenticacao_biometrica_id
         JOIN paciente p ON p.pessoa_fisica_id = ib.pessoa_fisica_id WHERE ib.id = ? AND p.id = ?`,
      [id, paciente],
    );
    expect(r).toMatchObject({
      modalidade: 'foto',
      situacao: 'ativa',
      tipo: 'FOTO_CONFERIDA',
      finalidade: FINALIDADE_FOTO_IDENTIFICACAO,
      entidade: 'paciente',
      tipo_mime: 'image/jpeg',
    });
    expect(Number(r!['entidade_id'])).toBe(paciente);
    expect(Number(r!['est'])).toBe(m!.estabelecimento);
    expect(Number(r!['usu'])).toBe(m!.usuario);
    const ret = r!['retencao_ate'];
    expect(ret instanceof Date ? ret.toISOString().slice(0, 10) : String(ret).slice(0, 10)).toBe(
      guardaFotoIdentificacaoAte(new Date().toISOString().slice(0, 10)),
    );
    const lida = await fotos.lerFoto(c(), paciente);
    expect(lida?.tipoMime).toBe('image/jpeg');
    expect(Buffer.compare(lida!.conteudo, Buffer.from(jpeg(1)))).toBe(0);
    expect(await fotos.lerFoto(c(), semFoto)).toBeNull();
  });

  it('substituição: a nova vale, a anterior fica no histórico e o arquivo continua', async () => {
    const antes = (await fotos.identificacao(c(), paciente)).ativa!.id;
    const nova = await fotos.cadastrarFoto(
      c(),
      { paciente, conteudo: jpeg(2) },
      trilha('identificacao_biometrica'),
    );
    const s = await fotos.identificacao(c(), paciente);
    expect(s.baseLegal).toBe('lgpd_art11_ii_f_g');
    expect(s.ativa?.id).toBe(nova);
    expect(s.historico.map((f) => [f.id, f.situacao])).toEqual([[antes, 'substituida']]);
    const n = await um<{ n: unknown }>(
      `SELECT COUNT(*) AS n FROM identificacao_biometrica ib JOIN paciente p ON p.pessoa_fisica_id = ib.pessoa_fisica_id
        WHERE p.id = ? AND ib.situacao = 'ativa'`,
      [paciente],
    );
    expect(Number(n!['n'])).toBe(1);
    const arqs = await um<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM arquivo WHERE finalidade = ? AND entidade = 'paciente' AND entidade_id = ? AND excluido_em IS NULL",
      [FINALIDADE_FOTO_IDENTIFICACAO, paciente],
    );
    expect(Number(arqs!['n'])).toBe(2);
  });

  it('conferência: confirmada pela foto ativa, dispensada pelo documento, recusas', async () => {
    const ativa = (await fotos.identificacao(c(), paciente)).ativa!.id;
    const v = await conferir(paciente, 'confirmada', 'descartado');
    const r = await um(
      `SELECT v.identificacao_biometrica_id AS foto, v.resultado, v.contexto, v.motivo_dispensa, v.usuario_id,
              v.estabelecimento_id, t.codigo AS tipo FROM verificacao_biometrica v
         JOIN tipo_autenticacao_biometrica t ON t.id = v.tipo_autenticacao_biometrica_id WHERE v.id = ?`,
      [v],
    );
    expect(r).toMatchObject({
      resultado: 'confirmada',
      contexto: 'recepcao',
      motivo_dispensa: null,
      tipo: 'FOTO_CONFERIDA',
    });
    expect(Number(r!['foto'])).toBe(ativa);
    expect(Number(r!['usuario_id'])).toBe(m!.usuario);
    expect(Number(r!['estabelecimento_id'])).toBe(m!.estabelecimento);
    expect(await codigo(conferir(semFoto, 'confirmada'))).toBe('sem-foto');
    expect(await codigo(conferir(semFoto, 'dispensada', 'abc'))).toBe('conferencia-invalida');
    expect(await codigo(conferir(paciente, 'confirmada', null, 999_999_999))).toBe(
      'atendimento-de-outro-paciente',
    );
    const d = await conferir(semFoto, 'dispensada', 'Paciente inconsciente');
    const rd = await um(
      `SELECT v.identificacao_biometrica_id AS foto, v.motivo_dispensa, t.codigo AS tipo FROM verificacao_biometrica v
         JOIN tipo_autenticacao_biometrica t ON t.id = v.tipo_autenticacao_biometrica_id WHERE v.id = ?`,
      [d],
    );
    expect(rd).toMatchObject({
      foto: null,
      motivo_dispensa: 'Paciente inconsciente',
      tipo: 'DOCUMENTO_CONFERIDO',
    });
    const s = await fotos.identificacao(c(), paciente);
    expect(s.conferencias.map((x) => x.resultado)).toEqual(['confirmada']);
  });

  it('revogação: exige motivo, tira a foto da conferência e nada é apagado', async () => {
    expect(await codigo(fotos.revogarFoto(c(), { paciente, motivo: 'abc' }, trilha('x')))).toBe(
      'motivo-obrigatorio',
    );
    expect(
      await codigo(
        fotos.revogarFoto(c(), { paciente: semFoto, motivo: 'foto de outra pessoa' }, trilha('x')),
      ),
    ).toBe('sem-foto');
    const id = await fotos.revogarFoto(
      c(),
      { paciente, motivo: 'foto de outra pessoa' },
      trilha('identificacao_biometrica'),
    );
    const r = await um('SELECT situacao, revogada_em FROM identificacao_biometrica WHERE id = ?', [id]);
    expect(r!['situacao']).toBe('revogada');
    expect(r!['revogada_em']).not.toBeNull();
    expect((await fotos.identificacao(c(), paciente)).ativa).toBeNull();
    expect(await fotos.lerFoto(c(), paciente)).toBeNull();
    expect(await codigo(conferir(paciente, 'confirmada'))).toBe('sem-foto');
    const n = await um<{ n: unknown }>(
      `SELECT COUNT(*) AS n FROM identificacao_biometrica ib JOIN paciente p ON p.pessoa_fisica_id = ib.pessoa_fisica_id
        WHERE p.id = ?`,
      [paciente],
    );
    expect(Number(n!['n'])).toBe(2);
  });
});
