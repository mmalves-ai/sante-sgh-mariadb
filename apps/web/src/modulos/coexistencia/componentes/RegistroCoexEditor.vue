<script setup lang="ts">
// W0-09 (D-RETRO-REGISTRO-F6): o registro do fim da coexistência ou da retrocompatibilidade gravado pela tela. O
// parâmetro coexistencia.registro.modo escolhe o caminho: 'tela' grava aqui uma versão nova (registro inteiro, no
// mesmo esquema do registro versionado, conferido pelo servidor), com motivo e senha, e pode voltar a valer o
// registro versionado; 'excecao' (registrada) deixa a mudança só no registro versionado e a tela só mostra. Toda
// versão fica no histórico com quem, quando e o motivo (nada se edita nem se apaga).
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { gravarRegistroCoex, lerRegistroCoex, type TipoRegistroCoexTela } from '../api.js';
import AcaoCicloDialogo from './AcaoCicloDialogo.vue';

const props = defineProps<{ tipo: TipoRegistroCoexTela }>();
const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({
  queryKey: ['coexistencia', 'registro', props.tipo],
  queryFn: () => lerRegistroCoex(props.tipo),
});
const registro = computed(() => consulta.data.value);
/** Gravar é crítico (config.desligamento.registrar, com a senha de novo); ler basta para ver o histórico. */
const podeGravar = computed(() => pode('config.desligamento.registrar'));
const instante = (d: string) => new Date(d).toLocaleString('pt-BR');

const gravando = ref(false);
const voltando = ref(false);
const texto = ref('');
const aviso = ref('');

function abrirGravar(): void {
  const c = registro.value?.conteudo;
  texto.value = c ? JSON.stringify(c, null, 2) : '';
  gravando.value = true;
}

/** O registro digitado tem de ser um objeto JSON; o esquema completo é conferido pelo servidor. */
function lerTexto(): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(texto.value);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const validarTexto = () => (lerTexto() ? '' : t('coexistencia.registro.jsonInvalido'));

async function gravar(motivo: string, senha: string): Promise<void> {
  await gravarRegistroCoex(props.tipo, lerTexto(), motivo, senha);
}
async function voltar(motivo: string, senha: string): Promise<void> {
  await gravarRegistroCoex(props.tipo, null, motivo, senha);
}
async function feito(chave: string): Promise<void> {
  aviso.value = t(chave);
  await cliente.invalidateQueries({ queryKey: ['coexistencia'] });
}
</script>

<template>
  <section class="registro" :data-testid="`registro-coex-${props.tipo}`">
    <h2>{{ t(`coexistencia.registro.titulo.${props.tipo}`) }}</h2>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('coexistencia.registro.carregando') }}</p>
    <template v-else-if="registro">
      <p data-testid="registro-coex-modo">{{ t(`coexistencia.registro.modos.${registro.modo}`) }}</p>
      <p data-testid="registro-coex-fonte">
        {{
          registro.fonte === 'tela'
            ? t('coexistencia.registro.fonteTela', { versao: registro.versaoVigente })
            : t('coexistencia.registro.fonteArquivo')
        }}
      </p>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="registro-coex-aviso" />
      <div v-if="registro.modo === 'tela' && podeGravar" class="botoes">
        <SanteBotao
          :rotulo="t('coexistencia.registro.gravar')"
          data-testid="registro-coex-gravar"
          @acionar="abrirGravar"
        />
        <SanteBotao
          v-if="registro.fonte === 'tela'"
          variante="secundario"
          :rotulo="t('coexistencia.registro.voltarArquivo')"
          data-testid="registro-coex-voltar"
          @acionar="voltando = true"
        />
      </div>
      <h3>{{ t('coexistencia.registro.historico') }}</h3>
      <p v-if="registro.historico.length === 0">{{ t('coexistencia.registro.semHistorico') }}</p>
      <table v-else class="tabela" data-testid="registro-coex-historico">
        <thead>
          <tr>
            <th>{{ t('coexistencia.registro.versao') }}</th>
            <th>{{ t('coexistencia.registro.quando') }}</th>
            <th>{{ t('coexistencia.registro.quem') }}</th>
            <th>{{ t('coexistencia.registro.motivo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in registro.historico" :key="v.versao">
            <td>
              {{ v.versao }}
              <span v-if="v.retornoAoArquivo">({{ t('coexistencia.registro.retorno') }})</span>
            </td>
            <td>{{ instante(v.gravadoEm) }}</td>
            <td>{{ v.gravadoPor }}</td>
            <td>{{ v.motivo }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <AcaoCicloDialogo
      v-if="gravando"
      v-model:visivel="gravando"
      :titulo="t(`coexistencia.registro.titulo.${props.tipo}`)"
      :texto="t('coexistencia.registro.gravarTexto')"
      :rotulo="t('coexistencia.registro.gravar')"
      com-senha
      :validar="validarTexto"
      :executar="gravar"
      @feito="feito('coexistencia.registro.gravado')"
    >
      <label class="campo">
        <span>{{ t('coexistencia.registro.conteudo') }}</span>
        <textarea v-model="texto" rows="14" spellcheck="false" data-testid="registro-coex-conteudo" />
      </label>
    </AcaoCicloDialogo>
    <AcaoCicloDialogo
      v-if="voltando"
      v-model:visivel="voltando"
      :titulo="t('coexistencia.registro.voltarArquivo')"
      :texto="t('coexistencia.registro.voltarTexto')"
      :rotulo="t('coexistencia.registro.voltarArquivo')"
      com-senha
      :executar="voltar"
      @feito="feito('coexistencia.registro.voltou')"
    />
  </section>
</template>

<style scoped>
.registro,
.campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.campo textarea {
  font-family: monospace;
}
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
</style>
