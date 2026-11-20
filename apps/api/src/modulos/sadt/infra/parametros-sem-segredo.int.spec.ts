// Parâmetros do diagnóstico sem segredo sobre a cópia (ficha do M26, regra 10), READ ONLY: os parâmetros do setor de um
// usuário do laboratório e de cada setor saem só com os campos sem segredo; a senha gerencial, a senha de alterar
// resultado, o token, o cabeçalho e os caminhos e portas nunca são lidos nem devolvidos (só a natureza do oculto), e a
// guarda das respostas não acha credencial. Só contagens.
import { credenciaisNaResposta, SETORES_SADT } from '@sgh/contratos';
import { colunaSecretaDoParametro } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteSadt, ambienteSadt, codigos } from '../aplicacao/copia.spec-util.js';
import { portaSadtLegado } from '../porta-legado.js';
import { fonteCatalogoArquivo } from '@sgh/legado';
import { resolve } from 'node:path';

describe.skipIf(codigos.length === 0)('parâmetros sem segredo na cópia (READ ONLY)', () => {
  let a: AmbienteSadt;
  beforeAll(async () => {
    a = await ambienteSadt();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('só os campos sem segredo; os ocultos pela natureza; nenhuma credencial na resposta', async () => {
    const porta = portaSadtLegado(
      a.nucleo,
      fonteCatalogoArquivo(resolve(import.meta.dirname, '../../../../../../docs/operacoes/catalogo')),
    );
    const c = { rede: a.nucleo.rede, hospital: a.cod };
    const usuario = await a.nucleo.lerSomente({ ...c, traceId: 'int-m26-param' }, async (l) => {
      const [x] = await l.consultar('SELECT FIRST 1 USUARIO U FROM SIPARLAB ORDER BY 1', [], { teto: 1 });
      return String(x?.['U'] ?? '');
    });
    let campos = 0;
    for (const s of SETORES_SADT) {
      const p = await porta.parametros(c, s.codigo, usuario);
      campos += p.campos.length;
      for (const x of p.campos) expect(colunaSecretaDoParametro(x.campo)).toBe(false);
      expect(credenciaisNaResposta(p)).toEqual([]);
      // Nenhum campo é a coluna secreta (a marca "pede a senha", CHECK_…, é só uma escolha e pode aparecer).
      expect(JSON.stringify(p)).not.toMatch(/"(SENHAGERENCIAL|SENHAALTRES|HEADER_WS|TOKEN|CAMINHO_[A-Z_]*)"/);
      if (s.codigo === 'laboratorio') expect(p.ocultos).toContain('senha guardada');
    }
    expect(campos).toBeGreaterThan(0);
    console.log(`[${a.cod}] parâmetros do diagnóstico: ${campos} campos sem segredo nos 4 setores`);
  });
});
