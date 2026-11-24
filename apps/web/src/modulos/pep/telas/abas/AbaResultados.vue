<script setup lang="ts">
// Resultados (regra 12): destaque fora da faixa, valor crítico com ciência obrigatória (com a conduta), a
// tendência por elemento e o lançamento de exame feito fora do estabelecimento.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { darCiencia, lancarExameExterno, lerResultados } from '../../api-documentos.js';
import AvisoConsulta from '../../componentes/documentos/AvisoConsulta.vue';
import ComparativoResultados from '../../componentes/documentos/ComparativoResultados.vue';
import ImagensPaciente from '../../../sadt/componentes/ImagensPaciente.vue';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'resultados', props.paciente]),
  queryFn: () => lerResultados(props.paciente),
});
const conduta = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function ciente(exame: number): Promise<void> {
  erro.value = null;
  try {
    await darCiencia(props.paciente, exame, { conduta: (conduta.value[exame] ?? '').trim() });
    mensagem.value = t('pep.doc.gravado');
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
  } catch (e) {
    erro.value = e;
  }
}
const nome = ref('');
const metodo = ref('');
const realizado = ref('');
const laudo = ref('');
const itens = ref('');
const critico = ref(false);
async function lancar(): Promise<void> {
  erro.value = null;
  try {
    await lancarExameExterno(props.paciente, {
      nomeExame: nome.value.trim(),
      ...(metodo.value.trim() ? { metodo: metodo.value.trim() } : {}),
      realizadoEm: realizado.value,
      ...(laudo.value.trim() ? { laudo: laudo.value.trim() } : {}),
      critico: critico.value,
      itens: itens.value
        .split('\n')
        .map((l) => l.split('='))
        .filter((p) => p.length === 2 && p[0]!.trim() && p[1]!.trim())
        .map(([e, r]) => ({
          elemento: e!.trim(),
          resultado: r!.trim(),
          tipo: /^-?\d+([.,]\d+)?$/.test(r!.trim()) ? ('N' as const) : ('T' as const),
        })),
    });
    mensagem.value = t('pep.doc.gravado');
    nome.value = '';
    itens.value = '';
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="resultados-titulo" data-testid="aba-resultados-conteudo">
    <h2 id="resultados-titulo">{{ t('pep.doc.resultados.titulo') }}</h2>
    <ComparativoResultados :paciente="paciente" />
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="dados.data.value.pendentesCiencia > 0"
        :texto="t('pep.doc.resultados.pendentes', { n: dados.data.value.pendentesCiencia })"
        anunciar
      />
      <p v-if="dados.data.value.resultados.length === 0">{{ t('pep.doc.nenhum') }}</p>
      <ul class="lista">
        <li
          v-for="r in dados.data.value.resultados"
          :key="r.exame"
          class="cartao"
          :data-testid="`resultado-${r.exame}`"
        >
          <p>
            <strong>{{ r.nome }}</strong> · {{ dataHoraBr(r.liberadoEm) }} ·
            {{ t(`pep.doc.resultados.origem.${r.origem}`) }}
            <span v-if="r.critico" class="marcador">{{ t('pep.doc.resultados.critico') }}</span>
          </p>
          <table v-if="r.valores.length" class="tabela">
            <tbody>
              <tr v-for="v in r.valores" :key="v.elemento">
                <th scope="row">{{ v.elemento }}</th>
                <td>
                  {{ v.valor }} {{ v.unidade ?? '' }}
                  <span v-if="v.foraDaFaixa" class="marcador">{{
                    t(`pep.doc.resultados.${v.foraDaFaixa}`)
                  }}</span>
                  <span v-if="v.critico" class="marcador">{{ t('pep.doc.resultados.critico') }}</span>
                </td>
                <td>{{ v.referencia ? t('pep.doc.resultados.referencia', { faixa: v.referencia }) : '' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-for="(l, i) in r.texto" :key="i">{{ l }}</p>
          <p v-if="r.ciencia">
            {{
              t('pep.doc.resultados.ciente', {
                usuario: r.ciencia.usuario,
                data: dataHoraBr(r.ciencia.em),
                conduta: r.ciencia.conduta,
              })
            }}
          </p>
          <form
            v-else-if="r.critico && dados.data.value.ciencia.pode"
            class="linha"
            @submit.prevent="ciente(r.exame)"
          >
            <label class="campo">
              <span>{{ t('pep.doc.resultados.conduta') }}</span>
              <input
                v-model="conduta[r.exame]"
                maxlength="500"
                required
                :data-testid="`conduta-${r.exame}`"
              />
            </label>
            <SanteBotao
              tipo="submit"
              :rotulo="t('pep.doc.resultados.ciencia')"
              :data-testid="`ciencia-${r.exame}`"
            />
          </form>
        </li>
      </ul>
      <section v-if="dados.data.value.tendencias.length" aria-labelledby="tendencia-titulo">
        <h3 id="tendencia-titulo">{{ t('pep.doc.resultados.tendencia') }}</h3>
        <table v-for="s in dados.data.value.tendencias" :key="s.elemento" class="tabela">
          <caption>
            {{
              s.elemento
            }}
            {{
              s.unidade ? `(${s.unidade})` : ''
            }}
          </caption>
          <tbody>
            <tr v-for="p in s.pontos" :key="p.em">
              <td>{{ dataHoraBr(p.em) }}</td>
              <td>{{ String(p.valor).replace('.', ',') }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <!-- M47 (etapa 3): as imagens do paciente (lista de trabalho DICOM) com o link do visualizador. -->
      <ImagensPaciente :paciente="props.paciente" />
      <AvisoConsulta :acao="dados.data.value.externo" />
      <form
        v-if="dados.data.value.externo.pode"
        class="form"
        data-testid="form-exame-externo"
        @submit.prevent="lancar"
      >
        <h3>{{ t('pep.doc.resultados.externo') }}</h3>
        <div class="linha">
          <label
            ><span>{{ t('pep.doc.resultados.externoNome') }}</span
            ><input v-model="nome" maxlength="80" required
          /></label>
          <label
            ><span>{{ t('pep.doc.resultados.externoMetodo') }}</span
            ><input v-model="metodo" maxlength="80"
          /></label>
          <label
            ><span>{{ t('pep.doc.resultados.externoRealizado') }}</span
            ><input v-model="realizado" type="datetime-local" required
          /></label>
        </div>
        <label
          ><span>{{ t('pep.doc.resultados.externoItens') }}</span
          ><textarea v-model="itens" rows="3" />
        </label>
        <label
          ><span>{{ t('pep.doc.resultados.externoLaudo') }}</span
          ><textarea v-model="laudo" rows="3" maxlength="4000" />
        </label>
        <label class="marca"
          ><input v-model="critico" type="checkbox" />{{ t('pep.doc.resultados.externoCritico') }}</label
        >
        <SanteBotao tipo="submit" :rotulo="t('pep.doc.salvar')" />
      </form>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
