<script setup lang="ts">
// Reações e hemovigilância (M47, etapa 1; ficha, seção 7 e regra 5; cap-05b §5.11 "Indicadores"): os indicadores do
// período sempre com o numerador e o denominador impressos (reações e reações graves por mil transfusões, sinais vitais
// completos, urgentes no prazo, indicação escrita); a lista das reações com o tipo, o grau, a correlação, as condutas, o
// destino da bolsa e a sugestão de notificação ao núcleo de segurança do paciente (imediata ou de rotina); os campos da
// notificação só com as iniciais, o sexo e a idade, para copiar e digitar no portal da vigilância sanitária (nada vai
// sozinho para fora), e o registro da data do envio.
import { CONDUTAS_REACAO, CORRELACOES_REACAO, GRAVIDADES_REACAO, rotuloTipoReacao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerHemovigilancia, lerNotificacao, marcarNotificada } from '../api-transfusao.js';
import ErroTransfusao from '../componentes/ErroTransfusao.vue';

const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`sadt.transfusao.${k}`, p ?? {});
const hora = (x: string | null) => (x ? x.slice(0, 16).replace('T', ' ') : '—');
const periodo = reactive({ de: '', ate: '' });
const aplicado = ref({ de: '', ate: '' });
const dados = useQuery({
  queryKey: computed(() => ['transfusao', 'hemovigilancia', aplicado.value]),
  queryFn: () => lerHemovigilancia(aplicado.value.de, aplicado.value.ate),
});
const h = computed(() => dados.data.value);
const rotuloConduta = (c: string) => CONDUTAS_REACAO.find((x) => x.codigo === c)?.rotulo ?? c;
const rotuloGrau = (g: number) => GRAVIDADES_REACAO.find((x) => x.grau === g)?.rotulo ?? String(g);
const rotuloCorrelacao = (c: string) => CORRELACOES_REACAO.find((x) => x.codigo === c)?.rotulo ?? c;

const campos = ref<{ reacao: number; texto: string; enviadaEm: string | null } | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const enviadaEm = ref('');
async function verCampos(reacao: number): Promise<void> {
  erro.value = null;
  try {
    const r = await lerNotificacao(reacao);
    const c = r.campos;
    const linhas = [
      `Data da transfusão: ${c.dataTransfusao}`,
      `Data da reação: ${c.dataReacao}`,
      `Hemocomponente: ${c.hemocomponente}`,
      `Número da bolsa: ${c.numeroBolsa}`,
      `Tipo de reação: ${c.tipoReacao} (${c.tempo})`,
      `Gravidade: ${rotuloGrau(c.gravidade)}`,
      `Correlação: ${rotuloCorrelacao(c.correlacao)}`,
      `Sinais e sintomas: ${c.sinaisESintomas}`,
      `Condutas: ${c.condutas.map(rotuloConduta).join('; ')}`,
      `Paciente: ${c.paciente.iniciais}, sexo ${c.paciente.sexo}, ${c.paciente.idade ?? '—'} anos`,
    ];
    campos.value = { reacao, texto: linhas.join('\n'), enviadaEm: r.enviadaEm };
  } catch (x) {
    erro.value = x;
  }
}
async function copiar(): Promise<void> {
  if (!campos.value) return;
  try {
    await navigator.clipboard.writeText(campos.value.texto);
    mensagem.value = T('reacao.copiado');
  } catch {
    mensagem.value = null;
  }
}
async function registrarEnvio(): Promise<void> {
  if (!campos.value) return;
  erro.value = null;
  try {
    const agora = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const local = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}T${p2(agora.getHours())}:${p2(agora.getMinutes())}`;
    mensagem.value = (await marcarNotificada(campos.value.reacao, enviadaEm.value || local)).mensagem;
    campos.value = null;
    await dados.refetch();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-transfusao" aria-labelledby="hv-titulo" data-testid="tela-hemovigilancia">
    <h1 id="hv-titulo">{{ T('reacao.titulo') }}</h1>
    <form class="barra" data-testid="hv-periodo" @submit.prevent="aplicado = { ...periodo }">
      <span class="campo">
        <label for="hv-de">{{ T('de') }}</label>
        <input id="hv-de" v-model="periodo.de" type="date" />
      </span>
      <span class="campo">
        <label for="hv-ate">{{ T('ate') }}</label>
        <input id="hv-ate" v-model="periodo.ate" type="date" />
      </span>
      <SanteBotao tipo="submit" :rotulo="T('filtrar')" data-testid="hv-filtrar" />
    </form>
    <p v-if="mensagem" role="status" data-testid="hv-mensagem">{{ mensagem }}</p>
    <ErroTransfusao v-if="erro" :erro="erro" />
    <ErroTransfusao v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!h" role="status">{{ T('carregando') }}</p>
    <template v-else>
      <p class="secundario">{{ T('reacao.periodo') }}: {{ T('intervalo', { de: h.de, ate: h.ate }) }}</p>
      <section aria-labelledby="hv-ind">
        <h2 id="hv-ind">{{ T('reacao.indicadores') }}</h2>
        <table class="tabela" data-testid="hv-indicadores">
          <caption class="sr">
            {{
              T('reacao.indicadores')
            }}
          </caption>
          <tbody>
            <tr v-for="i in h.indicadores" :key="i.codigo" :data-testid="`hv-ind-${i.codigo}`">
              <th scope="row">{{ i.rotulo }}</th>
              <td>
                {{
                  i.valor === null
                    ? T('reacao.semValor')
                    : T('reacao.valor', { valor: i.valor, unidade: i.unidade })
                }}
              </td>
              <td class="secundario">
                {{ T('reacao.numeradorDenominador', { numerador: i.numerador, denominador: i.denominador }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <section aria-labelledby="hv-lista">
        <h2 id="hv-lista">{{ T('reacao.lista') }}</h2>
        <p v-if="h.reacoes.length === 0">{{ T('reacao.semReacoes') }}</p>
        <table v-else class="tabela" data-testid="hv-reacoes">
          <caption class="sr">
            {{
              T('reacao.lista')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ T('reacao.inicio') }}</th>
              <th scope="col">{{ T('paciente') }}</th>
              <th scope="col">{{ T('reacao.tipo') }}</th>
              <th scope="col">{{ T('reacao.gravidade') }}</th>
              <th scope="col">{{ T('reacao.correlacao') }}</th>
              <th scope="col">{{ T('reacao.condutas') }}</th>
              <th scope="col">{{ T('reacao.destinoBolsa') }}</th>
              <th scope="col">{{ T('situacao') }}</th>
              <th scope="col">{{ T('acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in h.reacoes"
              :key="r.id"
              :data-testid="`hv-reacao-${r.id}`"
              :data-prioridade="r.notificacao.prioridade"
            >
              <td>{{ hora(r.inicioEm) }}</td>
              <td>{{ r.paciente.nome }} · {{ r.bolsa.numero }}</td>
              <td>
                {{ r.tipo === 'outra' && r.descricaoOutra ? r.descricaoOutra : rotuloTipoReacao(r.tipo) }}
              </td>
              <td>{{ rotuloGrau(r.grau) }}</td>
              <td>{{ rotuloCorrelacao(r.correlacao) }}</td>
              <td>{{ r.condutas.map(rotuloConduta).join('; ') }}</td>
              <td>
                {{ T(`reacao.${r.destinoBolsa === 'naoSeAplica' ? 'naoSeAplicaBolsa' : r.destinoBolsa}`) }}
              </td>
              <td>
                <strong>{{
                  r.notificacao.prioridade === 'imediata'
                    ? T('reacao.prioridadeImediata')
                    : T('reacao.prioridadeRotina')
                }}</strong>
                ·
                {{
                  r.notificacao.enviadaEm
                    ? T('reacao.enviadaEm', { data: hora(r.notificacao.enviadaEm) })
                    : T('reacao.naoEnviada')
                }}
              </td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="T('reacao.verNotificacao')"
                  :data-testid="`hv-campos-${r.id}`"
                  @acionar="verCampos(r.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <section v-if="campos" class="cartao" aria-labelledby="hv-campos" data-testid="hv-notificacao">
        <h2 id="hv-campos">{{ T('reacao.camposNotificacao') }}</h2>
        <SanteAlerta variante="info" :texto="T('reacao.notivisa')" />
        <pre class="campos" data-testid="hv-campos-texto">{{ campos.texto }}</pre>
        <div class="barra">
          <SanteBotao :rotulo="T('reacao.copiarCampos')" data-testid="hv-copiar" @acionar="copiar" />
          <template v-if="!campos.enviadaEm && h.gravacao.acoes.reacao">
            <span class="campo">
              <label for="hv-enviada">{{ T('reacao.marcarEnviada') }}</label>
              <input id="hv-enviada" v-model="enviadaEm" type="datetime-local" />
            </span>
            <SanteBotao
              :rotulo="T('reacao.marcarEnviada')"
              data-testid="hv-marcar"
              @acionar="registrarEnvio"
            />
          </template>
          <SanteBotao variante="texto" :rotulo="T('requisicoes.fechar')" @acionar="campos = null" />
        </div>
      </section>
    </template>
  </section>
</template>

<style src="./estilo-transfusao.css"></style>
<style scoped>
.campos {
  white-space: pre-wrap;
}
</style>
