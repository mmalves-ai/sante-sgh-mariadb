<script setup lang="ts">
// Ajustes de valor do bem na ficha (W0-08, M1; CPC 27 e CPC 01): revisão de vida útil e residual (prospectiva, cotas
// passadas intactas), perda por impairment com o laudo do teste de recuperabilidade (vira lançamento contábil) e
// reavaliação (evento com o laudo, sem lançamento). Nada se edita: o ajuste se corrige por estorno, com motivo e a
// senha de novo, e o estornado segue na lista com quem, quando e por quê. O laudo (achado 6 da revisão) é o PDF anexado
// ao bem em "Laudos do bem" (guardado com Object Lock; imutável): o ajuste escolhe um deles no combo e a lista abre o PDF.
import {
  type AjusteBem,
  type BemPatrimonial,
  type TipoAjusteBem,
  TAMANHO_MAXIMO_LAUDO_BEM,
  TIPOS_AJUSTE_BEM,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SenhaConfirmacao from '../administracao/componentes/SenhaConfirmacao.vue';
import {
  anexarLaudo,
  arquivoEmBase64,
  estornarAjuste,
  lerAjustes,
  lerLaudos,
  registrarAjuste,
  urlArquivoLaudo,
} from './api-patrimonio.js';
import { centavosOuZero, dataBr, instante, reais, rotuloCompetencia } from './comum-patrimonio.js';
import ErroPatrimonio from './ErroPatrimonio.vue';

const props = defineProps<{ bem: BemPatrimonial; podeAjustar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();

const consulta = useQuery({
  queryKey: computed(() => ['patrimonio', 'ajustes', props.bem.id]),
  queryFn: () => lerAjustes(props.bem.id),
  retry: false,
});
const lista = computed(() => [...(consulta.data.value ?? [])].sort((a, b) => b.id - a.id));
const consultaLaudos = useQuery({
  queryKey: computed(() => ['patrimonio', 'laudos', props.bem.id]),
  queryFn: () => lerLaudos(props.bem.id),
  retry: false,
});
const laudos = computed(() => [...(consultaLaudos.data.value ?? [])].sort((a, b) => b.id - a.id));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

async function atualizar() {
  await cliente.invalidateQueries({ queryKey: ['patrimonio', 'ajustes', props.bem.id] });
  await cliente.invalidateQueries({ queryKey: ['patrimonio', 'bem', props.bem.id] });
  await cliente.invalidateQueries({ queryKey: ['patrimonio', 'bens'] });
}

// ── Registrar ───────────────────────────────────────────────────────────────────────────────────────────────────────
const registrando = ref(false);
const vazio = () => ({
  tipo: 'impairment' as TipoAjusteBem,
  vidaRestante: '',
  residual: '',
  recuperavel: '',
  valorJusto: '',
  laudo: '',
  motivo: '',
});
const r = ref(vazio());
const opcoesTipo = TIPOS_AJUSTE_BEM.map((x) => ({ valor: x, rotulo: t(`patrimonio.ajustes.tipos.${x}`) }));
const podeRegistrar = computed(() => props.podeAjustar && props.bem.situacao !== 'baixado');

/** O laudo escolhido no combo (um dos anexados ao bem); vazio é null. */
const laudo = computed(() => (r.value.laudo === '' ? null : Number(r.value.laudo)));
const opcoesLaudo = computed(() => [
  { valor: '', rotulo: t('patrimonio.ajustes.semLaudo') },
  ...laudos.value.map((l) => ({
    valor: String(l.id),
    rotulo: t('patrimonio.ajustes.laudos.opcao', { id: l.id, descricao: l.descricao }),
  })),
]);

// ── Anexar o laudo (PDF) ────────────────────────────────────────────────────────────────────────────────────────────
const anexando = ref(false);
const arquivo = ref<File | null>(null);
const descricaoLaudo = ref('');
const problemasLaudo = computed(() => {
  const p: string[] = [];
  const f = arquivo.value;
  if (!f || f.size === 0 || f.size > TAMANHO_MAXIMO_LAUDO_BEM) p.push('arquivo');
  if (descricaoLaudo.value.trim().length < 3) p.push('descricao');
  return p;
});
function escolherArquivo(e: Event) {
  arquivo.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}
async function enviarLaudo() {
  const f = arquivo.value;
  if (!f || problemasLaudo.value.length > 0) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const l = await anexarLaudo(props.bem.id, {
      nome: f.name.slice(0, 120) || 'laudo.pdf',
      descricao: descricaoLaudo.value.trim(),
      conteudo: await arquivoEmBase64(f),
    });
    mensagem.value = t('patrimonio.ajustes.laudos.anexado', { descricao: l.descricao });
    anexando.value = false;
    arquivo.value = null;
    descricaoLaudo.value = '';
    await cliente.invalidateQueries({ queryKey: ['patrimonio', 'laudos', props.bem.id] });
    // Quem anexou para registrar o ajuste já encontra o laudo escolhido.
    if (registrando.value) r.value.laudo = String(l.id);
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const problemas = computed(() => {
  const p: string[] = [];
  const x = r.value;
  if (x.tipo === 'revisao-estimativa') {
    if (!/^\d{1,4}$/.test(x.vidaRestante.trim()) || Number(x.vidaRestante) < 1) p.push('vidaRestante');
    if (centavosOuZero(x.residual) === null) p.push('residual');
  }
  if (x.tipo === 'impairment' && (x.recuperavel.trim() === '' || centavosOuZero(x.recuperavel) === null))
    p.push('recuperavel');
  if (x.tipo === 'reavaliacao' && (x.valorJusto.trim() === '' || centavosOuZero(x.valorJusto) === null))
    p.push('valorJusto');
  if (x.tipo !== 'revisao-estimativa' && laudo.value === null) p.push('laudo');
  if (x.motivo.trim().length < 5) p.push('motivo');
  return p;
});

function corpo() {
  const x = r.value;
  const base = { versao: props.bem.versao, motivo: x.motivo.trim() };
  if (x.tipo === 'revisao-estimativa')
    return {
      ...base,
      tipo: x.tipo,
      vidaRestanteMeses: Number(x.vidaRestante),
      residualCent: centavosOuZero(x.residual) ?? 0,
      laudo: laudo.value,
    };
  if (x.tipo === 'impairment')
    return {
      ...base,
      tipo: x.tipo,
      recuperavelCent: centavosOuZero(x.recuperavel) ?? 0,
      laudo: laudo.value!,
    };
  return { ...base, tipo: x.tipo, valorJustoCent: centavosOuZero(x.valorJusto) ?? 0, laudo: laudo.value! };
}

async function registrar() {
  if (problemas.value.length > 0) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const a = await registrarAjuste(props.bem.id, corpo());
    mensagem.value = t('patrimonio.ajustes.registrado', {
      tipo: t(`patrimonio.ajustes.tipos.${a.tipo}`),
      competencia: rotuloCompetencia(proxima(a.competenciaMarco)),
    });
    registrando.value = false;
    r.value = vazio();
    await atualizar();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

/** A competência seguinte ao marco ("2026-09" → "2026-10"): o ajuste vale dela em diante. */
function proxima(c: string): string {
  const [a, m] = c.split('-').map(Number) as [number, number];
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}

// ── Estornar ────────────────────────────────────────────────────────────────────────────────────────────────────────
const estornando = ref<AjusteBem | null>(null);
const motivoEstorno = ref('');
const senha = ref('');
const estornoPronto = computed(() => motivoEstorno.value.trim().length >= 5 && senha.value !== '');
function abrirEstorno(a: AjusteBem) {
  estornando.value = a;
  motivoEstorno.value = '';
  mensagem.value = null;
  erro.value = null;
}
async function estornar() {
  const a = estornando.value;
  if (!a || !estornoPronto.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    await estornarAjuste(a.id, { motivo: motivoEstorno.value.trim(), senha: senha.value });
    mensagem.value = t('patrimonio.ajustes.estornado', { tipo: t(`patrimonio.ajustes.tipos.${a.tipo}`) });
    estornando.value = null;
    await atualizar();
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="ajustes-titulo" data-testid="ajustes-bem">
    <h3 id="ajustes-titulo">{{ t('patrimonio.ajustes.titulo') }}</h3>
    <p class="secundario">{{ t('patrimonio.ajustes.ajuda') }}</p>
    <p v-if="mensagem" role="status" class="ok" data-testid="ajustes-mensagem">{{ mensagem }}</p>
    <ErroPatrimonio v-if="erro" :erro="erro" escopo="ajustes" />

    <div v-if="podeRegistrar && !registrando" class="acoes">
      <SanteBotao
        variante="secundario"
        :rotulo="t('patrimonio.ajustes.registrar')"
        data-testid="ajustes-registrar"
        @acionar="
          registrando = true;
          estornando = null;
          mensagem = null;
          erro = null;
        "
      />
    </div>

    <form v-if="registrando" class="bloco" data-testid="ajustes-form" @submit.prevent="registrar">
      <h4>{{ t('patrimonio.ajustes.registrar') }}</h4>
      <p class="secundario">{{ t(`patrimonio.ajustes.ajudaTipo.${r.tipo}`) }}</p>
      <p class="secundario">{{ t('patrimonio.ajustes.laudoAjuda') }}</p>
      <div class="campos">
        <SanteSelecao
          v-model="r.tipo"
          :rotulo="t('patrimonio.ajustes.tipo')"
          :opcoes="opcoesTipo"
          data-testid="ajustes-tipo"
        />
        <template v-if="r.tipo === 'revisao-estimativa'">
          <SanteCampoTexto
            v-model="r.vidaRestante"
            :rotulo="t('patrimonio.ajustes.vidaRestante')"
            :max-bytes="4"
            obrigatorio
            data-testid="ajustes-vida"
          />
          <SanteCampoTexto
            v-model="r.residual"
            :rotulo="t('patrimonio.ficha.residual')"
            :max-bytes="20"
            data-testid="ajustes-residual"
          />
        </template>
        <SanteCampoTexto
          v-if="r.tipo === 'impairment'"
          v-model="r.recuperavel"
          :rotulo="t('patrimonio.ajustes.recuperavel')"
          :max-bytes="20"
          obrigatorio
          data-testid="ajustes-recuperavel"
        />
        <SanteCampoTexto
          v-if="r.tipo === 'reavaliacao'"
          v-model="r.valorJusto"
          :rotulo="t('patrimonio.ajustes.valorJusto')"
          :max-bytes="20"
          obrigatorio
          data-testid="ajustes-valor-justo"
        />
        <SanteSelecao
          v-model="r.laudo"
          :rotulo="t('patrimonio.ajustes.laudo')"
          :opcoes="opcoesLaudo"
          :obrigatorio="r.tipo !== 'revisao-estimativa'"
          busca
          data-testid="ajustes-laudo"
        />
        <SanteCampoTexto
          v-model="r.motivo"
          :rotulo="t('patrimonio.motivo')"
          :max-bytes="400"
          multilinha
          obrigatorio
          data-testid="ajustes-motivo"
        />
      </div>
      <ul v-if="problemas.length > 0" class="secundario" data-testid="ajustes-problemas">
        <li v-for="p in problemas" :key="p">{{ t(`patrimonio.ajustes.problemas.${p}`) }}</li>
      </ul>
      <div class="acoes">
        <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="registrando = false" />
        <SanteBotao
          tipo="submit"
          :rotulo="t('patrimonio.gravar')"
          :desabilitado="ocupado || problemas.length > 0"
          data-testid="ajustes-gravar"
        />
      </div>
    </form>

    <p v-if="consulta.isError.value" class="secundario">—</p>
    <p v-else-if="!consulta.data.value" role="status">{{ t('patrimonio.carregando') }}</p>
    <p v-else-if="lista.length === 0" class="secundario" data-testid="ajustes-nenhum">
      {{ t('patrimonio.ajustes.nenhum') }}
    </p>
    <ul v-else data-testid="ajustes-lista">
      <li v-for="a in lista" :key="a.id" :data-testid="`ajuste-${a.id}`">
        <strong>{{ t(`patrimonio.ajustes.tipos.${a.tipo}`) }}</strong>
        <template v-if="a.estorno"> ({{ t('patrimonio.ajustes.estornadoRotulo') }})</template>:
        {{
          t('patrimonio.ajustes.linha', {
            data: dataBr(a.data),
            competencia: rotuloCompetencia(proxima(a.competenciaMarco)),
            antes: reais(a.valorContabilAntesCent),
            depois: reais(a.valorContabilDepoisCent),
          })
        }}
        <template v-if="a.tipo === 'impairment'">
          {{ t('patrimonio.ajustes.perda', { perda: reais(a.perdaCent) }) }}
        </template>
        <template v-if="a.tipo === 'revisao-estimativa'">
          {{
            t('patrimonio.ajustes.revisao', { meses: a.vidaRestanteMeses, residual: reais(a.residualCent) })
          }}
        </template>
        <template v-if="a.valorJustoCent !== null">
          {{ t('patrimonio.ajustes.justo', { valor: reais(a.valorJustoCent) }) }}
        </template>
        <a
          v-if="a.laudo !== null"
          :href="urlArquivoLaudo(a.laudo)"
          target="_blank"
          rel="noopener"
          :data-testid="`ajuste-laudo-${a.id}`"
          >{{ t('patrimonio.ajustes.laudoN', { n: a.laudo }) }}</a
        >
        <br />
        <span class="secundario">{{
          t('patrimonio.ajustes.quem', {
            por: a.registradoPor,
            em: instante(a.registradoEm),
            motivo: a.motivo,
          })
        }}</span>
        <template v-if="a.estorno">
          <br />
          <span class="secundario" :data-testid="`ajuste-estorno-${a.id}`">{{
            t('patrimonio.ajustes.quemEstornou', {
              por: a.estorno.estornadoPor,
              em: instante(a.estorno.estornadoEm),
              motivo: a.estorno.motivo,
            })
          }}</span>
        </template>
        <SanteBotao
          v-if="!a.estorno && podeAjustar && estornando?.id !== a.id"
          variante="texto"
          :rotulo="t('patrimonio.ajustes.estornar')"
          :data-testid="`ajuste-estornar-${a.id}`"
          @acionar="abrirEstorno(a)"
        />
        <form
          v-if="estornando?.id === a.id"
          class="bloco"
          :aria-label="t('patrimonio.ajustes.estornoTitulo')"
          data-testid="ajustes-estorno"
          @submit.prevent
        >
          <p class="secundario">{{ t('patrimonio.ajustes.estornoAjuda') }}</p>
          <SanteCampoTexto
            v-model="motivoEstorno"
            :rotulo="t('patrimonio.motivo')"
            :max-bytes="400"
            multilinha
            obrigatorio
            data-testid="ajustes-estorno-motivo"
          />
          <SenhaConfirmacao v-model="senha" testid="ajustes-estorno-senha" />
          <div class="acoes">
            <SanteBotao
              variante="secundario"
              :rotulo="t('patrimonio.cancelar')"
              @acionar="estornando = null"
            />
            <SanteBotao
              variante="destrutivo"
              :rotulo="t('patrimonio.ajustes.estornar')"
              :confirmacao="
                t('patrimonio.ajustes.confirmarEstorno', { tipo: t(`patrimonio.ajustes.tipos.${a.tipo}`) })
              "
              :desabilitado="ocupado || !estornoPronto"
              data-testid="ajustes-estorno-confirmar"
              @acionar="estornar"
            />
          </div>
        </form>
      </li>
    </ul>

    <section class="bloco" aria-labelledby="laudos-titulo" data-testid="laudos-bem">
      <h4 id="laudos-titulo">{{ t('patrimonio.ajustes.laudos.titulo') }}</h4>
      <p class="secundario">{{ t('patrimonio.ajustes.laudos.ajuda') }}</p>
      <div v-if="podeRegistrar && !anexando" class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('patrimonio.ajustes.laudos.anexar')"
          data-testid="laudos-anexar"
          @acionar="
            anexando = true;
            mensagem = null;
            erro = null;
          "
        />
      </div>
      <form v-if="anexando" class="bloco" data-testid="laudos-form" @submit.prevent="enviarLaudo">
        <div class="campos">
          <span class="campo-arquivo">
            <label for="laudo-arquivo">{{ t('patrimonio.ajustes.laudos.arquivo') }}</label>
            <input
              id="laudo-arquivo"
              type="file"
              accept="application/pdf,.pdf"
              data-testid="laudos-arquivo"
              @change="escolherArquivo"
            />
          </span>
          <SanteCampoTexto
            v-model="descricaoLaudo"
            :rotulo="t('patrimonio.ajustes.laudos.descricao')"
            :max-bytes="200"
            obrigatorio
            data-testid="laudos-descricao"
          />
        </div>
        <ul v-if="problemasLaudo.length > 0" class="secundario" data-testid="laudos-problemas">
          <li v-for="p in problemasLaudo" :key="p">{{ t(`patrimonio.ajustes.laudos.problemas.${p}`) }}</li>
        </ul>
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="anexando = false" />
          <SanteBotao
            tipo="submit"
            :rotulo="t('patrimonio.ajustes.laudos.enviar')"
            :desabilitado="ocupado || problemasLaudo.length > 0"
            data-testid="laudos-enviar"
          />
        </div>
      </form>
      <p v-if="consultaLaudos.isError.value" class="secundario">—</p>
      <p v-else-if="!consultaLaudos.data.value" role="status">{{ t('patrimonio.carregando') }}</p>
      <p v-else-if="laudos.length === 0" class="secundario" data-testid="laudos-nenhum">
        {{ t('patrimonio.ajustes.laudos.nenhum') }}
      </p>
      <ul v-else data-testid="laudos-lista">
        <li v-for="l in laudos" :key="l.id" :data-testid="`laudo-${l.id}`">
          {{
            t('patrimonio.ajustes.laudos.linha', {
              descricao: l.descricao,
              nome: l.nome,
              tamanho: Math.max(1, Math.round(l.tamanho / 1024)),
              por: l.enviadoPor,
              em: instante(l.enviadoEm),
            })
          }}
          <a
            :href="urlArquivoLaudo(l.id)"
            target="_blank"
            rel="noopener"
            :data-testid="`laudo-abrir-${l.id}`"
            >{{ t('patrimonio.ajustes.laudos.abrir') }}</a
          >
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
