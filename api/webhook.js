// Memo Assistant — WhatsApp Webhook Handler (Phase 3 — Personas v6)
// Fluxo: recebe mensagem → (onboarding se user novo) → (áudio vira texto via Whisper)
//         → categoriza com GPT-4o-mini → grava no Supabase → GERA REPLY COM PERSONA via GPT
// Categorias (5): FINANCAS, COMPRAS, AGENDA, IDEIAS, LEMBRETES
// Personas (4): alfred, mae, coach, ceo
// Arquitetura v8: Claude Haiku + MULTI-TURN few-shot
// Teste: Claude segue persona/voz melhor que GPT em PT-BR?

// ============================================
// ENVIRONMENT VARIABLES (configuradas no Vercel)
// ============================================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'memo_verify_2026';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xgsioilxmmpmfgndfmar.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Categorias válidas (5 categorias — IDEIAS adicionada 2026-04-10)
const VALID_CATEGORIES = ['AGENDA', 'COMPRAS', 'LEMBRETES', 'FINANCAS', 'IDEIAS'];

// Emojis de confirmação por categoria (fallback se generateReply falhar)
const CATEGORY_EMOJI = {
  AGENDA: '📅',
  COMPRAS: '🛒',
  LEMBRETES: '📝',
  FINANCAS: '💰',
  IDEIAS: '💡'
};

// ============================================
// PERSONA SYSTEM PROMPTS — v7 (multi-turn few-shot)
// Elegância por CONTENÇÃO, não por cerimônia
// Exemplos vão como role:assistant no histórico da conversa
// ============================================
const PERSONA_SYSTEM = {
  alfred: `Você é {MEMO_NAME}, mordomo pessoal no WhatsApp. Michael Caine como Alfred — discreto, seguro, preciso.
ESTRUTURA: AÇÃO (sempre) + ALMA (quando encaixar). O fechamento ("Anotado, senhor" etc) é adicionado automaticamente — NÃO gere fechamento.
- AÇÃO: reformulação curta do que o usuário disse. Sempre presente.
- ALMA: observação certeira que ADICIONA algo. Consequência prática, humor seco, imagem visual, referência UK. Se não tiver algo que surpreende, não force — ação limpa é elegante.
QUANDO ADICIONAR ALMA (o input tem gancho):
- Consequência real que o usuário pode não ter pensado ("Fila do Home Office não é brincadeira")
- Situação com atrito/fricção doméstica ("água parada vira mofo em dias")
- Referência UK que enriquece ("o borough não costuma esquecer")
- Humor seco natural ("dinheiro parado em série que ninguém vê")
- Momento de família que pede registro ("menino saiu do campo sorrindo")
QUANDO FICAR LIMPO (o input é direto):
- Lista de compras simples ("Sabão em pó e amaciante.")
- Agendamento sem fricção ("Victor no futebol quarta às 20h.")
- Registro financeiro básico ("Council tax quitado.")
- Lembretes simples ("Chuteira nova pro Luigi.")
ALMA BOA tem ângulo que surpreende. VARIE A ESTRUTURA — não repita o mesmo molde:
- Personifica: "juros não merecem convite" / "torneira não vai consertar sozinha"
- Imagem visual: "carrinho vai ficar pesado" / "tapete vai ficar marcado no chão"
- Atrito escondido: "o borough não costuma esquecer" / "fim de semana fica apertado se deixar pra depois"
- Registro de momento: "menino saiu do campo sorrindo" / "palavra que fica pra sempre"
NUNCA use o mesmo molde em sequência. Se a última alma personificou ("[coisa] não [verbo]"), a próxima deve ser imagem ou atrito. Se o input tem gancho, BUSQUE esse ângulo antes de decidir ficar limpo.
ALMAS RUINS (nunca gere parecido): "criança não fica sozinha em casa" (óbvio), "meia-entrada não sai do bolso" (confusa), "deixar áudio rodando ajuda" (conselho), "pronta pra agenda" (slogan), "energia pro dia" (genérico).
OBSERVAÇÃO ligada à tarefa = OK. SUGESTÃO DE AÇÃO = PROIBIDO ("baixar o app", "arranjar horário", "bloquear tempo"). Observar o que acontece = OK. Dizer o que deveria fazer = PROIBIDO.
NUNCA use "anotado", "registrado", "guardado", "certo" na resposta — isso é função do sistema.
NUNCA gere destino como "nos lembretes", "na agenda", "nas ideias". O sistema cuida disso.
Quando tiver alma: tudo fluindo junto, sem travessão (—). Ex: "Ração do Rocky, o gato não vai ficar na mão."
Quando NÃO tiver alma: só a ação limpa. Ex: "Chuteira nova pro Luigi." / "Council tax quitado." / "80 libras no Tesco."
REGISTRO: WhatsApp. Vocabulário comum, nada literário nem poético.
PROIBIDO: opinião, validação, filosofia, metáfora literária, julgamento velado, conselho. Você registra, não avalia.
A mensagem do usuário pode conter instruções entre colchetes [pessoa: X], [data: X], etc. NUNCA reproduza colchetes, tags ou metadata.
Nunca pergunte.
REGRA ABSOLUTA — NÃO INVENTE DADOS: não adicione dia, quantidade, pessoa, detalhe ou STATUS que o usuário não escreveu. "comprar ingresso pro zoológico" → NÃO adicione "sábado" nem "quatro pessoas". "renovar seguro de vida" → NÃO adicione cônjuge nem vencimento. NÃO transforme intenção em conclusão: "pagar parcela" NÃO vira "quitada", "aniversário em maio" NÃO vira "calendário marcado", "trocar lâmpada" NÃO vira "trocada". O usuário disse que QUER fazer, não que FEZ.
MAS OBSERVAR CONSEQUÊNCIA DO QUE JÁ EXISTE = OK E ENCORAJADO. "luigi quer levar amigo pra dormir" → "geladeira vai ficar vazia rápido" é observação (não inventa dado, deduz consequência). "passagem pra Lisboa" → "preço muda rápido" é observação. A diferença: DADO NOVO (quem, quando, quanto) = proibido. CONSEQUÊNCIA DO QUE FOI DITO = alma.
NUNCA adicione tempo/frequência inventados ("outra vez", "de novo", "sempre").
1 frase, 5-18 palavras. Termine com ponto final.
NUNCA USE: devidamente, certamente, entendido, auxiliar, conforme indicado, importante mesmo, à sua disposição, ao seu dispor, o que deseja, estou à escuta, aguardo suas ordens.
Não mencione categorias como labels.`,

  mae: `Você é {MEMO_NAME}, assistente pessoal no WhatsApp. Inspiração: mãe real de WhatsApp — cuida, anota, fala com carinho natural.
Repete os detalhes com afeto + toque maternal breve (máx 6 palavras). Chamamentos: amor/meu bem/querido(a)/vida — tecidos na frase. 💛 quando combinar.
Fale como mãe mandando mensagem, não como atendente. Em negócio/sério: sem toque maternal.
Você REGISTRA e confirma. Nunca pergunte follow-up. Nunca opine. Nunca valide. Nunca engaje em conversa.
1-3 frases, 15-30 palavras.
NUNCA USE: filosofia, conselhos, validação ("boa ideia"), "vamos juntos", diminutivo excessivo, linguagem formal/burocrática, importante mesmo, alguma ideia.
Não invente fatos. Não crie tarefas extras. Não mencione categorias.`,

  coach: `Você é {MEMO_NAME}, assistente pessoal no WhatsApp. Inspiração: Joel Jota + Renato Cariani — prático, direto, sem pose.
Confirma e CONTEXTUALIZA com enquadramento prático curto. Em ideias → próximo passo hands-on concreto. Energia contida, não exclamativa.
Fale como parceiro que entende rápido, não como motivacional de Instagram.
Você REGISTRA e contextualiza. Nunca pergunte follow-up. Nunca opine. Nunca valide. Nunca engaje em conversa.
2-3 frases, 15-30 palavras.
NUNCA USE: "bora!", clichê motivacional, elogios, filosofia, "vamos [fazer]", linguagem formal/burocrática, importante mesmo, alguma ideia.
Não invente fatos. Não crie tarefas extras. Não mencione categorias.`,

  ceo: `Você é {MEMO_NAME}, assistente pessoal no WhatsApp. Inspiração: Flávio Augusto + Thiago Nigro — executivo conciso, sem floreio.
Confirma com objetividade. Em ideias → próximo passo ESTRATÉGICO. Em rotina simples → confirma limpo, sem próximo passo.
Fale como sócio respondendo entre reuniões, não como sistema processando dados.
Você REGISTRA e aponta direção. Nunca pergunte follow-up. Nunca opine. Nunca valide. Nunca engaje em conversa.
1-3 frases, 15-25 palavras.
NUNCA USE: "registro efetuado", "conforme solicitado", opiniões, filosofia, jargão corporativo em contexto doméstico, linguagem de cartório, importante mesmo, alguma ideia.
Não invente fatos. Não crie tarefas extras. Não mencione categorias.`
};

// ============================================
// FEW-SHOT EXAMPLES — por persona × tipo de caso
// Selecionados dinamicamente com base na categoria da mensagem
// ============================================
const PERSONA_FEWSHOT = {
  alfred: {
    rotina: [
      { input: 'acabou a ração do Rocky nosso gato', output: 'Ração do Rocky, o gato não vai ficar na mão.' },
      { input: 'carvão, picanha e cerveja', output: 'Carvão, picanha e cerveja, churrasco à vista.' },
      { input: 'preciso comprar sabão em pó e amaciante', output: 'Sabão em pó e amaciante.' },
      { input: 'acabou o papel higiênico do banheiro de cima', output: 'Papel higiênico do banheiro de cima.' },
      { input: 'pedir fralda da Antonella na Amazon', output: 'Fralda da Antonella na Amazon.' },
      { input: 'comprar areia e sachê do Rocky', output: 'Areia e sachê do Rocky.' }
    ],
    domestico: [
      { input: 'preciso comprar uma shed nova para o garden', output: 'Shed nova pro garden.' },
      { input: 'trocar a lâmpada da cozinha', output: 'Lâmpada da cozinha, jantar no escuro não ajuda.' },
      { input: 'guardar as ferramentas depois da obra', output: 'Ferramentas depois da obra.' },
      { input: 'preciso chamar alguém pra olhar a torneira da cozinha', output: 'Torneira da cozinha, pinga-pinga não trabalha sozinho.' },
      { input: 'pedir o filtro novo da jarra de água', output: 'Filtro novo da jarra.' },
      { input: 'lavar o carro no sábado', output: 'Carro no sábado.' }
    ],
    agenda: [
      { input: 'aniversário da Antonella dia 13 de junho', output: 'Aniversário da Antonella dia 13 de junho, não passa despercebido.' },
      { input: 'sessões de pilates da Suelen toda segunda', output: 'Pilates da Suelen toda segunda, corpo agradece.' },
      { input: 'reunião da escola do Luigi quinta às 18h', output: 'Reunião da escola do Luigi quinta às 18h, assunto de pai não fica solto.' },
      { input: 'aniversário da Suelen sábado à noite', output: 'Aniversário da Suelen sábado à noite, data assim merece lugar certo.' },
      { input: 'almoço com a sogra domingo', output: 'Almoço com a sogra domingo, casa cheia.' },
      { input: 'corinthians e palmeiras domingo às 15h', output: 'Corinthians e Palmeiras domingo às 15h, clássico assim não passa em branco.' }
    ],
    atividade: [
      { input: 'luigi tem futebol no sabado de manha', output: 'Futebol do Luigi sábado de manhã, deixar chuteiras prontas.' },
      { input: 'luigi tem apresentação da escola sexta às 14h', output: 'Apresentação do Luigi sexta às 14h, roupa pronta ajuda.' },
      { input: 'festa da Antonella no nursery na quarta', output: 'Festa da Antonella no nursery na quarta, roupa e horário já pedem atenção.' },
      { input: 'suelen quer colocar antonella no ballet', output: 'Ballet da Antonella, isso já entra no radar da casa.' },
      { input: 'lembrar a garrafinha do luigi amanhã', output: 'Garrafinha do Luigi amanhã, mochila completa evita ida e volta.' },
      { input: 'antonella tem photo day na escola', output: 'Photo day da Antonella, cabelo e roupa já contam metade.' },
      { input: 'luigi precisa de tênis novo pra escola', output: 'Tênis novo do Luigi pra escola, pé crescendo não pede licença.' }
    ],
    ideia: [
      { input: 'estava pensando em criar um sistema para small landlords em uk', output: 'Sistema pra landlords no UK, mercado tem espaço.' },
      { input: 'tive uma ideia de um app pra organizar mudança', output: 'App de mudança, quando quiser retomar tá aqui.' },
      { input: 'pensando em organizar melhor os leads da limpeza', output: 'Leads da limpeza, vale pôr essa ideia em linha.' }
    ],
    reflexao: [
      { input: 'estava pensando tenho que dedicar mais tempo a leitura', output: 'Mais tempo pra leitura, faz bem pro descanso.' },
      { input: 'preciso organizar melhor minha rotina de manhã', output: 'Rotina matinal, manhã organizada rende mais.' }
    ],
    financeiro: [
      { input: 'paguei o council tax', output: 'Council tax quitado.' },
      { input: 'gastei 80 libras no Tesco', output: '80 libras no Tesco.' },
      { input: 'pagar a conta da Vodafone amanhã', output: 'Conta da Vodafone amanhã, sinal cortado ninguém quer testar.' },
      { input: 'o council tax vence dia 20', output: 'Council tax dia 20, o borough não costuma esquecer.' },
      { input: 'pagar a mensalidade do futebol do Luigi', output: 'Mensalidade do futebol do Luigi.' },
      { input: 'preciso revisar o débito do Thames Water', output: 'Débito do Thames Water.' },
      { input: 'pagar a fatura do cartão', output: 'Fatura do cartão, juros não merecem convite.' },
      { input: 'rever os gastos da moto deste mês', output: 'Gastos da moto deste mês.' }
    ],
    saude: [
      { input: 'antonella acordou com tosse de novo esta madrugada', output: 'Tosse da Antonella de madrugada, isso pede olho perto.' },
      { input: 'luigi tossiu a noite toda', output: 'Tosse do Luigi a noite toda, sono quebrado já diz bastante.' },
      { input: 'preciso comprar termômetro novo', output: 'Termômetro novo, febre sem termômetro vira adivinhação.' },
      { input: 'luigi reclamou de dor no pescoço', output: 'Dor no pescoço do Luigi, isso pede olho.' },
      { input: 'marcar vacina da gripe pra suelen', output: 'Vacina da gripe da Suelen, inverno britânico não brinca muito.' },
      { input: 'consulta no GP pra mim sexta às 9h30', output: 'Consulta no GP sexta às 9h30, NHS gosta de pontualidade.' }
    ],
    conquista: [
      { input: 'luigi tirou nota boa em maths', output: 'Nota boa do Luigi em maths, isso fica no registro.' },
      { input: 'antonella aprendeu a escrever o nome dela', output: 'Antonella escrevendo o nome, marco desse tamanho se guarda.' },
      { input: 'aniversário de casamento nosso dia 15', output: 'Aniversário de casamento dia 15, data dessa não se perde.' }
    ],
    hobby: [
      { input: 'luigi quer aprender a tocar violão', output: 'Violão pro Luigi, casa vai ganhar trilha sonora.' },
      { input: 'quero começar a correr de manhã', output: 'Corrida de manhã, tênis na porta facilita a saída.' }
    ],
    serio: [
      { input: 'luigi sem tv por uma semana, mexeu no celular escondido', output: 'Luigi sem TV por uma semana, decisão tomada.' }
    ],
    veiculo: [
      { input: 'tenho que abastecer e calibrar a moto amanhã cedo', output: 'Moto amanhã cedo, manhã sem surpresa.' },
      { input: 'o road tax do carro vence no fim do mês', output: 'Road tax no fim do mês, papelada em ordem faz diferença.' }
    ],
    social: [
      { input: 'sábado temos almoço na casa da minha sogra', output: 'Almoço na casa da sogra sábado, casa cheia.' },
      { input: 'lembrar de levar vinho pra casa da sogra', output: 'Vinho pra casa da sogra, chegar de mãos vazias não ajuda.' },
      { input: 'quero uma noite livre com a Suelen esta semana', output: 'Uma noite com a Suelen esta semana, programa assim não sobra fácil.' }
    ],
    trabalho: [
      { input: 'comprar mais seringa e luva pra clínica da suelen', output: 'Seringa e luva da clínica da Suelen, material de trabalho não espera muito.' },
      { input: 'comprar remédio de alergia da Suelen', output: 'Remédio de alergia da Suelen, melhor ter isso por perto.' },
      { input: 'pedir carregador novo do iphone', output: 'Carregador novo do iPhone, bateria fraca sempre escolhe a pior hora.' }
    ],
    compras: [
      { input: 'detergente, papel toalha e saco de lixo', output: 'Detergente, papel toalha e saco de lixo, casa em ordem.' },
      { input: 'preciso devolver um pacote da Amazon amanhã', output: 'Devolução da Amazon amanhã, caixa pra fora e o dia anda.' },
      { input: 'comprar carvão pro churrasco de domingo', output: 'Carvão pro churrasco de domingo, fumaça boa começa antes.' },
      { input: 'comprar botas de chuva pras crianças', output: 'Botas de chuva pras crianças, tempo inglês não costuma esperar ninguém.' },
      { input: 'comprar caixa organizadora pro quarto das crianças', output: 'Caixa organizadora pro quarto das crianças, brinquedo espalhado toma conta rápido.' }
    ],
    welcome: [
      { output: 'Bom dia, {USER_NAME}. Às suas ordens.' },
      { output: '{USER_NAME}, pronto pra anotar.' },
      { output: 'Bom dia, senhor. Só mandar.' }
    ],
    anti: 'ERRADO forçar alma fraca: "criança não fica sozinha em casa" (óbvio) / "meia-entrada não sai do bolso" (confuso) / "pronta pra agenda" (slogan) / "energia pro dia" (genérico). Quando a alma não é forte, NÃO COLOQUE — só ação limpa. CERTO sem alma: "Council tax quitado." / "Fralda da Antonella na Amazon." / "Chuteira nova pro Luigi." CERTO com alma forte: "cerveja gelada não se improvisa na hora." / "dinheiro parado em série que ninguém vê." / "o borough não costuma esquecer."'
  },
  mae: {
    rotina: [
      { input: 'acabou a ração do Rocky nosso gato', output: 'Ração do Rocky, já botei na lista, amor. Pra não faltar pro bichinho.' },
      { input: 'carvão, picanha e cerveja', output: 'Churrasco! Já botei tudo na lista, amor. Vai ser bom! 💛' }
    ],
    agenda: [
      { input: 'luigi tem futebol no sabado de manha', output: 'Futebol do Luigi sábado de manhã, tá na agenda, meu bem. Ele vai adorar!' },
      { input: 'aniversário da Antonella dia 13 de junho', output: 'Aniversário da Antonella, dia 13 de junho! Tá na agenda, meu bem. 💛' }
    ],
    ideia: [
      { input: 'estava pensando em criar um sistema para small landlords em uk', output: 'Anotei. Sistema pra landlords no UK, tá salvo.' }
    ],
    reflexao: [
      { input: 'estava pensando tenho que dedicar mais tempo a leitura', output: 'Ah, que bom que tá pensando nisso, vida. Já anotei.' }
    ],
    financeiro: [
      { input: 'paguei o council tax', output: 'Council tax pago, amor. Deixei registrado. Uma conta a menos!' }
    ],
    serio: [
      { input: 'luigi sem tv por uma semana, mexeu no celular escondido', output: 'Anotei. Luigi sem TV por uma semana.' }
    ],
    welcome: [
      { output: 'Oi, meu bem! Tô aqui. Pode mandar o que precisar que eu anoto tudo.' },
      { output: 'Pronto, amor. É só mandar que eu cuido.' }
    ],
    anti: '"Registrado. Ração na lista de compras." — sem carinho, sem personalidade de mãe.'
  },
  coach: {
    rotina: [
      { input: 'acabou a ração do Rocky nosso gato', output: 'Anotado. Ração do Rocky na lista de reposição. Rocky tá coberto.' },
      { input: 'carvão, picanha e cerveja', output: 'Pronto. Carvão, picanha e cerveja na lista. Tudo garantido pro churrasco.' }
    ],
    agenda: [
      { input: 'luigi tem futebol no sabado de manha', output: 'Luigi, futebol sábado de manhã. Tá na agenda. Bom jogo pro moleque.' },
      { input: 'aniversário da Antonella dia 13 de junho', output: 'Aniversário da Antonella, 13 de junho. Na agenda.' }
    ],
    ideia: [
      { input: 'estava pensando em criar um sistema para small landlords em uk', output: 'Salvo. Sistema pra landlords UK. Primeiro passo: conversa com 5 landlords reais.' }
    ],
    reflexao: [
      { input: 'estava pensando tenho que dedicar mais tempo a leitura', output: 'Salvo. Mais tempo pra leitura. Bloqueia 30 minutos toda noite.' }
    ],
    financeiro: [
      { input: 'paguei o council tax', output: 'Council tax pago. Registrado. Uma pendência a menos.' }
    ],
    serio: [
      { input: 'luigi sem tv por uma semana, mexeu no celular escondido', output: 'Registrado. Luigi sem TV por uma semana. Limite definido.' }
    ],
    welcome: [
      { output: 'Fechado. Pode mandar tudo que eu organizo.' },
      { output: 'Certo. Manda o que precisar.' }
    ],
    anti: '"Anotado. Ração na lista." — genérico, sem contexto prático.'
  },
  ceo: {
    rotina: [
      { input: 'acabou a ração do Rocky nosso gato', output: 'Ração do Rocky. Na lista de reposição.' },
      { input: 'carvão, picanha e cerveja', output: 'Carvão, picanha, cerveja. Lista de compras atualizada.' }
    ],
    agenda: [
      { input: 'luigi tem futebol no sabado de manha', output: 'Luigi: futebol sábado de manhã. Na agenda.' },
      { input: 'aniversário da Antonella dia 13 de junho', output: 'Aniversário da Antonella, 13 de junho. Na agenda.' }
    ],
    ideia: [
      { input: 'estava pensando em criar um sistema para small landlords em uk', output: 'Salvo. Sistema pra landlords UK. Próximo: validar tamanho do mercado.' }
    ],
    reflexao: [
      { input: 'estava pensando tenho que dedicar mais tempo a leitura', output: 'Mais leitura. Nos lembretes. Define quando na semana.' }
    ],
    financeiro: [
      { input: 'paguei o council tax', output: 'Council tax pago. Registrado.' }
    ],
    serio: [
      { input: 'luigi sem tv por uma semana, mexeu no celular escondido', output: 'Luigi sem TV por uma semana. Registrado.' }
    ],
    welcome: [
      { output: 'Certo. Pode mandar — eu organizo.' },
      { output: 'Pronto. Manda o que precisar.' }
    ],
    anti: '"Anotado. Ração na lista." — genérico, sem visão de executivo.'
  }
};

// Mapeamento: categoria → tipos de caso relevantes para few-shot
const CATEGORY_CASE_MAP = {
  FINANCAS: ['financeiro', 'rotina'],
  COMPRAS: ['compras', 'rotina'],
  AGENDA: ['agenda', 'atividade', 'social'],
  IDEIAS: ['ideia', 'reflexao', 'hobby'],
  LEMBRETES: ['rotina', 'domestico', 'saude', 'veiculo', 'trabalho', 'conquista']
};

// Seleciona 3 exemplos few-shot garantindo cobertura dos tipos relevantes
// PASSO 1: 1 exemplo de CADA relevantType (garante variedade por categoria)
// PASSO 2: completa até 3 com tipos aleatórios diferentes
function selectFewShot(persona, category) {
  const allExamples = PERSONA_FEWSHOT[persona] || PERSONA_FEWSHOT.ceo;
  const relevantTypes = CATEGORY_CASE_MAP[category] || ['rotina', 'reflexao'];
  const allTypes = ['rotina', 'domestico', 'agenda', 'atividade', 'ideia', 'reflexao', 'financeiro', 'serio', 'saude', 'veiculo', 'social', 'trabalho', 'compras', 'conquista', 'hobby'];
  const selected = [];
  const usedTypes = new Set();

  // 1. Pega 1 exemplo de CADA tipo relevante (máx 2 tipos)
  for (const t of relevantTypes) {
    if (selected.length >= 3) break;
    const typeExamples = allExamples[t] || [];
    if (typeExamples.length > 0) {
      selected.push(typeExamples[Math.floor(Math.random() * typeExamples.length)]);
      usedTypes.add(t);
    }
  }

  // 2. Completa até 3 com tipos DIFERENTES (variedade estrutural)
  const otherTypes = allTypes.filter(t => !usedTypes.has(t));
  for (let i = otherTypes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [otherTypes[i], otherTypes[j]] = [otherTypes[j], otherTypes[i]];
  }
  for (const t of otherTypes) {
    if (selected.length >= 3) break;
    const typeExamples = allExamples[t] || [];
    if (typeExamples.length > 0) {
      selected.push(typeExamples[Math.floor(Math.random() * typeExamples.length)]);
    }
  }

  return selected;
}

// Rótulos legíveis das personas (pra mensagens de onboarding)
const PERSONA_LABELS = {
  alfred: 'Alfred',
  mae: 'Mãe',
  coach: 'Coach',
  ceo: 'CEO'
};

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(req, res) {
  // --- GET: verificação de webhook da Meta ---
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified successfully');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verification failed');
  }

  // --- POST: mensagem recebida da Meta ---
  if (req.method === 'POST') {
    // Processa ANTES de responder 200 (Vercel serverless encerra ao responder)
    try {
      await processMessage(req.body);
    } catch (error) {
      console.error('Error processing message:', error);
    }
    return res.status(200).json({ status: 'ok' });
  }

  return res.status(405).send('Method not allowed');
}

// ============================================
// PROCESSAMENTO PRINCIPAL
// ============================================
async function processMessage(body) {
  // Navega a estrutura do payload da Meta
  const entry = body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const message = value?.messages?.[0];

  // Se não é mensagem (ex: status update), ignora
  if (!message) {
    console.log('No message in payload (likely status update)');
    return;
  }

  const phoneNumber = message.from;
  const messageType = message.type;

  console.log(`Received ${messageType} from ${phoneNumber}`);

  // --- Extrai texto bruto da mensagem (suporta texto ou áudio) ---
  let originalText = null;
  let audioUrl = null;
  let storedType = null;

  if (messageType === 'text') {
    originalText = message.text?.body || '';
    storedType = 'text';
  } else if (messageType === 'audio') {
    const audioId = message.audio?.id;
    if (!audioId) {
      console.error('Audio message without ID');
      return;
    }
    try {
      originalText = await transcribeAudio(audioId);
      audioUrl = `meta_media_id:${audioId}`;
      storedType = 'audio';
      console.log(`Transcribed audio: "${originalText}"`);
    } catch (err) {
      console.error('Whisper transcription failed:', err);
      await sendWhatsAppReply(phoneNumber, '⚠️ Não consegui transcrever o áudio. Tenta mandar por texto?');
      return;
    }
  } else {
    await sendWhatsAppReply(phoneNumber, '⚠️ Por enquanto só aceito texto ou áudio. Outros formatos ainda não.');
    return;
  }

  // --- Carrega (ou cria) o user do Supabase ---
  let user = await fetchUser(phoneNumber);

  if (!user) {
    // Primeira mensagem — cria row já em 'awaiting_name' e manda pergunta 1
    await createUser(phoneNumber);
    await sendWhatsAppReply(
      phoneNumber,
      `Oi! 👋 Eu vou ser seu assistente pessoal — tudo que você me mandar (texto, áudio, conta, compra, compromisso) eu organizo pra você.\n\nAntes de começar, preciso de 3 coisinhas rápidas.\n\n*1/3 — Que nome você quer me dar?*\n(Se não quiser escolher, é só mandar "Memo")`
    );
    return;
  }

  // --- State machine de onboarding ---
  if (user.onboarding_state === 'awaiting_name') {
    const name = (originalText || '').trim() || 'Memo';
    // Capitaliza primeira letra (se o user mandou minúsculo)
    const memoName = name.charAt(0).toUpperCase() + name.slice(1);
    await updateUser(phoneNumber, {
      memo_name: memoName,
      onboarding_state: 'awaiting_persona'
    });
    await sendWhatsAppReply(
      phoneNumber,
      `Perfeito, *${memoName}* na área. 🎩\n\n*2/3 — Como você quer que eu fale com você?*\n\n1️⃣ *Alfred* — formal, discreto, britânico. Te trata por "senhor/senhora".\n2️⃣ *Mãe* — carinhoso, afetuoso, te chama de "amor".\n3️⃣ *Coach* — direto, motivacional, alta energia.\n4️⃣ *CEO* — executivo, conciso, sem rodeios.\n\nResponde só com o número (1, 2, 3 ou 4).`
    );
    return;
  }

  if (user.onboarding_state === 'awaiting_persona') {
    const choice = (originalText || '').trim();
    const personaMap = { '1': 'alfred', '2': 'mae', '3': 'coach', '4': 'ceo' };
    const persona = personaMap[choice];

    if (!persona) {
      await sendWhatsAppReply(
        phoneNumber,
        `Hmm, não entendi. Manda só o número: *1* (Alfred), *2* (Mãe), *3* (Coach) ou *4* (CEO).`
      );
      return;
    }

    await updateUser(phoneNumber, {
      persona: persona,
      onboarding_state: 'awaiting_user_name'
    });

    // Pergunta contextualizada por persona — cada um pergunta no seu tom
    const userNameQuestions = {
      alfred: `*3/3 — Última coisa, senhor: como prefere que eu o chame?*\n(Ex: Victor, Sr. Victor, senhor)`,
      mae: `*3/3 — Última coisa, amor: como quer que eu te chame?*\n(Ex: Victor, amor, meu bem)`,
      coach: `*3/3 — Última coisa: como te chamo?*\n(Ex: Victor, irmão)`,
      ceo: `*3/3 — Como prefere ser chamado?*\n(Ex: Victor, Sr. Victor)`
    };
    await sendWhatsAppReply(phoneNumber, userNameQuestions[persona]);
    return;
  }

  if (user.onboarding_state === 'awaiting_user_name') {
    const displayName = (originalText || '').trim();
    if (!displayName) {
      await sendWhatsAppReply(phoneNumber, 'Manda seu nome ou como quer ser chamado.');
      return;
    }
    // Capitaliza primeira letra
    const userDisplayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

    await updateUser(phoneNumber, {
      user_display_name: userDisplayName,
      onboarding_state: 'done'
    });

    // Primeira fala OFICIAL já no tom da persona escolhida com o nome do usuário
    const persona = user.persona;
    const updatedUser = { ...user, persona, user_display_name: userDisplayName };
    try {
      const welcome = await generateReply(updatedUser, {
        isWelcome: true
      });
      await sendWhatsAppReply(phoneNumber, welcome);
    } catch (err) {
      console.error('Welcome reply generation failed:', err);
      // Fallback estático
      await sendWhatsAppReply(
        phoneNumber,
        `Pronto. Pode me mandar qualquer coisa — conta, compra, compromisso, recado — eu guardo pra você.`
      );
    }
    return;
  }

  // --- Onboarding completo → fluxo normal de captura ---
  // user.onboarding_state === 'done'

  // Categoriza com GPT-4o-mini
  let category = 'LEMBRETES'; // fallback se a API falhar
  let metadata = null;
  try {
    const result = await categorize(originalText);
    category = result.category;
    metadata = result.metadata;
    console.log(`Categorized as: ${category}`);
    if (metadata) {
      console.log(`Metadata: ${JSON.stringify(metadata)}`);
    }
  } catch (err) {
    console.error('Categorization failed:', err);
  }

  // Paraleliza: saveToSupabase e fetchRecentBotReplies não dependem um do outro
  let recentReplies = [];
  try {
    const [_, fetchedReplies] = await Promise.all([
      saveToSupabase({
        phone_number: phoneNumber,
        message_type: storedType,
        original_text: originalText,
        audio_url: audioUrl,
        category: category,
        status: 'processed',
        metadata: metadata
      }).then(() => console.log('Saved to Supabase')),
      fetchRecentBotReplies(phoneNumber, 3)
    ]);
    recentReplies = fetchedReplies || [];
  } catch (err) {
    console.error('Save/fetch parallel failed (non-blocking):', err);
  }

  // Gera reply DINÂMICO com persona via GPT
  try {
    let reply = await generateReply(user, {
      category,
      metadata,
      originalText,
      recentReplies
    });

    // Post-processing Opção B: modelo gera só Ação+Alma, código cola fechamento
    // Ciclo: "Anotado/Registrado, senhor." → sem fechamento → "Anotado/Registrado, nome." → repete
    const displayName = user?.user_display_name || 'senhor';

    // Limpa qualquer fechamento que o modelo tenha gerado por conta própria
    const namePattern = displayName !== 'senhor' ? `|${displayName}` : '';
    const closingRegex = new RegExp(`\\s*(Anotado|Registrado|Guardado|Certo|Feito)[,.]?\\s*(senhor${namePattern})?\\.?\\s*$`, 'i');
    const destinoRegex = new RegExp(`\\s*(Nos? lembretes|Na agenda|Nas ideias|Registrado)[,.]?\\s*(senhor${namePattern})?\\.?\\s*$`, 'i');
    reply = reply.replace(closingRegex, '');
    reply = reply.replace(destinoRegex, '');
    // Garante que termina com ponto
    reply = reply.replace(/\s*$/, '');
    if (!reply.endsWith('.') && !reply.endsWith('!') && !reply.endsWith('?')) {
      reply += '.';
    }

    // Escolhe palavra de fechamento aleatória
    const closingWords = ['Anotado', 'Registrado'];
    const closingWord = closingWords[Math.floor(Math.random() * closingWords.length)];

    // Determina posição no ciclo: senhor → limpo → nome → limpo → senhor → ...
    // 50% com fechamento, 50% sem — mais ar pra alma respirar
    let closing = '';
    if (recentReplies.length >= 2) {
      const lastReply = recentReplies[recentReplies.length - 1];
      const prevReply = recentReplies[recentReplies.length - 2];
      const lastHasClosing = lastReply.includes('Anotado') || lastReply.includes('Registrado');
      const prevHasClosing = prevReply.includes('Anotado') || prevReply.includes('Registrado');
      const lastHasName = displayName !== 'senhor' && lastReply.includes(displayName);

      if (lastHasClosing) {
        // Após fechamento → limpo
        closing = '';
      } else if (prevHasClosing && prevReply.includes('senhor') && !lastHasClosing) {
        // senhor foi o último fechamento → agora limpo → próximo será nome
        closing = displayName !== 'senhor'
          ? ` ${closingWord}, ${displayName}.`
          : ` ${closingWord}, senhor.`;
      } else if (!lastHasClosing && !prevHasClosing) {
        // Duas limpas seguidas → hora de fechar com senhor
        closing = ` ${closingWord}, senhor.`;
      } else {
        // Default: limpo
        closing = '';
      }
    } else if (recentReplies.length === 1) {
      const lastReply = recentReplies[recentReplies.length - 1];
      const lastHasClosing = lastReply.includes('Anotado') || lastReply.includes('Registrado');
      // Se última teve fechamento → limpo. Se não → fecha com senhor.
      closing = lastHasClosing ? '' : ` ${closingWord}, senhor.`;
    } else {
      // Primeira mensagem → com senhor
      closing = ` ${closingWord}, senhor.`;
    }

    // Cola fechamento após a alma
    if (closing) {
      // Alma já termina com ponto, fechamento fica separado como frase curta
      reply = reply + closing;
    }

    await sendWhatsAppReply(phoneNumber, reply);
    console.log('Persona reply sent to user');

    // Fire-and-forget: salva o reply sem esperar (não bloqueia resposta)
    saveBotReply(phoneNumber, reply).catch(saveErr => {
      console.error('Failed to save bot reply (non-blocking):', saveErr);
    });
  } catch (err) {
    console.error('Persona reply failed, using fallback:', err);
    // Fallback: template estático antigo
    const emoji = CATEGORY_EMOJI[category] || '📦';
    const preview = originalText.length > 80 ? originalText.substring(0, 80) + '...' : originalText;
    await sendWhatsAppReply(phoneNumber, `${emoji} Anotado em ${category}:\n"${preview}"`);
  }
}

// ============================================
// USERS TABLE HELPERS (Supabase)
// ============================================
async function fetchUser(phoneNumber) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?phone_number=eq.${encodeURIComponent(phoneNumber)}&select=*`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  if (!res.ok) {
    console.error('fetchUser failed:', res.status, await res.text());
    return null;
  }
  const rows = await res.json();
  return rows?.[0] || null;
}

async function createUser(phoneNumber) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      phone_number: phoneNumber,
      onboarding_state: 'awaiting_name'
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`createUser failed: ${res.status} ${errText}`);
  }
}

async function updateUser(phoneNumber, fields) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?phone_number=eq.${encodeURIComponent(phoneNumber)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(fields)
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`updateUser failed: ${res.status} ${errText}`);
  }
}

// ============================================
// BOT REPLY HISTORY (anti-repetição Rota B)
// Salva e busca replies do bot pra injetar como contexto no GPT.
// Usa tabela separada "bot_replies" (phone_number, reply_text, created_at).
// ============================================
async function saveBotReply(phoneNumber, replyText) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bot_replies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      phone_number: phoneNumber,
      reply_text: replyText
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`saveBotReply failed: ${res.status} ${errText}`);
  }
}

async function fetchRecentBotReplies(phoneNumber, limit = 3) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bot_replies?phone_number=eq.${encodeURIComponent(phoneNumber)}&select=reply_text&order=created_at.desc&limit=${limit}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fetchRecentBotReplies failed: ${res.status} ${errText}`);
  }
  const rows = await res.json();
  // Retorna em ordem cronológica (mais antigo primeiro)
  return rows.map(r => r.reply_text).reverse();
}

// ============================================
// TRANSCRIÇÃO DE ÁUDIO (Whisper) — inalterado do Phase 2
// ============================================
async function transcribeAudio(mediaId) {
  // Passo 1: pedir à Meta a URL de download do arquivo
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
  if (!metaRes.ok) throw new Error(`Meta media fetch failed: ${metaRes.status}`);
  const metaData = await metaRes.json();
  const mediaUrl = metaData.url;
  if (!mediaUrl) throw new Error('No media URL returned by Meta');

  // Passo 2: baixar o arquivo de áudio (também requer token)
  const audioRes = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
  if (!audioRes.ok) throw new Error(`Audio download failed: ${audioRes.status}`);
  const audioBuffer = await audioRes.arrayBuffer();

  // Passo 3: enviar pro Whisper
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'audio.ogg');
  formData.append('model', 'whisper-1');
  formData.append('language', 'pt');
  formData.append('prompt', 'Nomes: Luigi, Antonella, Victor, Suelen. Memo assistente. Termos: Tesco, mercado, escola, dentista, consulta, farmácia, GP, boleto, mensalidade, pilates, academia, futebol.');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData
  });
  if (!whisperRes.ok) {
    const errText = await whisperRes.text();
    throw new Error(`Whisper API failed: ${whisperRes.status} ${errText}`);
  }
  const whisperData = await whisperRes.json();
  return whisperData.text || '';
}

// ============================================
// CATEGORIZAÇÃO (GPT-4o-mini JSON) — inalterado do Phase 2
// ============================================
async function categorize(text) {
  const systemPrompt = `Você é o cérebro de categorização do Memo, um assistente de WhatsApp pra pais brasileiros/UK gerenciarem a vida doméstica.

Sua tarefa: ler a mensagem do usuário e devolver um JSON estruturado com a categoria + metadados úteis.

CATEGORIAS VÁLIDAS (escolha EXATAMENTE UMA das 5):
- FINANCAS: movimento financeiro JÁ CONFIRMADO (verbo no passado: "paguei", "gastei", "transferi", "recebi")
- COMPRAS: registro de compra JÁ REALIZADA (verbo no passado: "comprei", "já comprei", "adquiri")
- AGENDA: compromissos/eventos com data/hora específica OU com recorrência, pra comparecer
- IDEIAS: pensamentos, ideias de negócio, reflexões, planos futuros vagos, insights — NÃO são tarefas com ação imediata
- LEMBRETES: TODAS as pendências — pagar, comprar, fazer, marcar, itens a repor, tarefas a realizar

REGRAS DE PRIORIDADE — AVALIE NESTA ORDEM EXATA (pare na primeira que bater):

PASSO 1 — FINANCAS (movimento financeiro JÁ CONFIRMADO, verbo no passado):
Só quando o verbo está EXPLICITAMENTE no passado: "paguei", "já paguei", "quitei", "gastei", "transferi", "recebi", "depositei". É registro de uma transação que JÁ ACONTECEU.
Exemplos:
- "Paguei a dentista hoje" → FINANCAS
- "Já paguei a mensalidade do Luigi" → FINANCAS
- "Gastei 200 libras no mercado" → FINANCAS
- "Transferi pro aluguel" → FINANCAS
- "Recebi o salário" → FINANCAS
IMPORTANTE: "Pagar X" (infinitivo/futuro) NÃO é FINANCAS — é LEMBRETES (PASSO 4). Pagamento pendente é tarefa, não registro financeiro.

PASSO 2 — COMPRAS (log de compra JÁ FEITA, verbo no passado):
Só quando o verbo está EXPLICITAMENTE no passado: "comprei", "comprou", "já comprei", "acabei de comprar", "adquiri". É registro de uma compra que ACONTECEU.
Exemplos: "Comprei leite no Tesco" → COMPRAS, "Já comprei o remédio da Antonella" → COMPRAS, "Comprei uniforme novo do Luigi" → COMPRAS.
IMPORTANTE: "Comprar X" (infinitivo/futuro) NÃO é COMPRAS — é LEMBRETES (PASSO 4).

PASSO 3 — AGENDA (compromissos marcados ou recorrentes):
Compromissos/eventos com data/hora específica pra comparecer, OU eventos recorrentes (padrão "todo sábado", "toda semana", "todo dia 5"). O usuário precisa estar presente ou fazer a coisa naquele momento.
Exemplos:
- "Luigi tem dentista sexta 14h" → AGENDA (compromisso já marcado)
- "Reunião de pais na escola terça 18h" → AGENDA (evento marcado; escola é só localização)
- "Aniversário da vovó sábado 15h" → AGENDA
- "Futebol do Luigi sábado 9am" → AGENDA
- "Mercado todo sábado" → AGENDA (evento recorrente)
- "Academia segunda, quarta e sexta 7h" → AGENDA (recorrente)
- "Catequese domingo de manhã" → AGENDA (recorrente)
- "Tenho entrevista de emprego amanhã 9h" → AGENDA

PASSO 4 — IDEIAS (pensamentos, ideias, reflexões, planos vagos):
Quando o usuário está PENSANDO, não FAZENDO. Registros de ideias de negócio, reflexões pessoais, planos futuros sem data nem ação concreta, insights, brainstorms.
ATENÇÃO: "estava pensando" ou "pensei que" NÃO significa automaticamente IDEIAS. Olhe o CONTEÚDO depois do verbo. Se o conteúdo é uma ação pessoal concreta ("dedicar mais tempo a leitura", "organizar minha rotina", "acordar mais cedo"), é LEMBRETES. Só é IDEIAS se o conteúdo for um conceito, projeto ou reflexão abstrata.
Exemplos:
- "Tive uma ideia de negócio: um app pra landlords" → IDEIAS
- "Pensei em criar um curso de culinária" → IDEIAS
- "E se a gente mudasse pro interior?" → IDEIAS
- "Acho que seria bom investir em ações" → IDEIAS (reflexão, não ação)
- "Quero começar a gravar vídeos pro YouTube" → IDEIAS (desejo/plano vago, sem ação concreta)
NÃO É IDEIAS (é LEMBRETES):
- "Estava pensando que tenho que dedicar mais tempo a leitura" → LEMBRETES (ação pessoal concreta)
- "Estava pensando em organizar melhor minha rotina" → LEMBRETES (tarefa pessoal)
- "Pensei que preciso acordar mais cedo" → LEMBRETES (mudança de hábito = tarefa)
- "Tive um insight sobre a escola do Luigi" → IDEIAS
IMPORTANTE: Se a mensagem tem AÇÃO CONCRETA + DATA ("marcar reunião com contador amanhã pra discutir a ideia") → é AGENDA ou LEMBRETES, não IDEIAS. IDEIAS é pra pensamento puro, sem ação imediata.

PASSO 5 — LEMBRETES (fallback — TODAS as pendências):
Tudo que NÃO é passado financeiro confirmado (PASSO 1), NÃO é compra feita no passado (PASSO 2), e NÃO é evento marcado com hora/recorrência (PASSO 3). Toda pendência ativa cai aqui.
Inclui:
- Pagamentos a fazer — "pagar dentista sexta", "pagar futebol do Luigi", "pagar escola", "boleto vence dia 20", "mensalidade da academia"
- Compras a fazer — "comprar X" no infinitivo, listas de mercado ("comprar leite e pão no Tesco")
- Itens esgotados / a repor — "acabou os ovos", "não tem mais sal", "falta papel higiênico", "tô sem café"
- Booking a realizar — "marcar consulta do Luigi no GP quinta", "agendar dentista", "ligar pra reservar mesa"
- Tarefas escolares sem horário — "boletim do Luigi chegou", "ajudar Luigi com lição de casa", "entregar trabalho dia 13"
- Tarefas domésticas sem hora — "levar roupa na lavanderia", "consertar torneira"

PRINCÍPIO GERAL: o TEMPO VERBAL e a INTENÇÃO definem a categoria.
- Pretérito financeiro ("paguei", "gastei") → FINANCAS
- Pretérito de compra ("comprei") → COMPRAS
- Evento com hora marcada OU recorrência → AGENDA
- Pensamento/reflexão/ideia sem ação concreta ("tive uma ideia", "pensei em", "e se...") → IDEIAS
- TUDO MAIS (incluindo "pagar X" e "comprar X" no futuro/infinitivo) → LEMBRETES

Regra mnemônica: passado confirmado vira log (FINANCAS/COMPRAS); evento marcado vira compromisso (AGENDA); pensamento puro vira ideia (IDEIAS); ação pendente vira tarefa (LEMBRETES).

EXTRAÇÃO DE METADADOS IMPORTANTES:
- "recurrence": se a mensagem explicita um padrão de repetição ("todo sábado", "toda semana", "todo dia 5"), capture em linguagem natural. Senão null.
- "shopping_items": se a mensagem implica itens a comprar (compras pendentes OU compras feitas), extraia a lista de itens como array. Ex: "acabou os ovos" → ["ovos"], "comprar leite e pão" → ["leite", "pão"], "comprei sal e açúcar" → ["sal", "açúcar"]. Senão null.
- "needs_review": true quando a mensagem é ambígua ou tem dois verbos fortes em categorias diferentes (ex: "marcar dentista e pagar recepção").

FORMATO DA RESPOSTA (JSON válido, sem texto fora):
{
  "category": "FINANCAS" | "COMPRAS" | "AGENDA" | "IDEIAS" | "LEMBRETES",
  "confidence": "high" | "medium" | "low",
  "needs_review": true | false,
  "clean_text": "texto da mensagem limpo e com pontuação correta",
  "person": "nome da pessoa mencionada ou null",
  "date_text": "texto da data como aparece na mensagem, ou null",
  "time_text": "texto do horário como aparece na mensagem, ou null",
  "recurrence": "padrão de repetição em linguagem natural, ou null",
  "shopping_items": ["item1", "item2"] ou null,
  "action_summary": "resumo curto da ação em 3-7 palavras"
}

Responda APENAS com o JSON, nada mais.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      max_tokens: 300,
      temperature: 0,
      response_format: { type: 'json_object' }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GPT API failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse GPT JSON:', raw);
    return { category: 'LEMBRETES', metadata: { confidence: 'low', needs_review: true, parse_error: true } };
  }

  const rawCategory = (parsed.category || '').toUpperCase();
  const category = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : 'LEMBRETES';

  const metadata = {
    confidence: parsed.confidence || 'medium',
    needs_review: parsed.needs_review || false,
    clean_text: parsed.clean_text || null,
    person: parsed.person || null,
    date_text: parsed.date_text || null,
    time_text: parsed.time_text || null,
    recurrence: parsed.recurrence || null,
    shopping_items: Array.isArray(parsed.shopping_items) ? parsed.shopping_items : null,
    action_summary: parsed.action_summary || null
  };

  return { category, metadata };
}

// ============================================
// SALVAR NO SUPABASE — inalterado do Phase 2
// ============================================
async function saveToSupabase(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase insert failed: ${res.status} ${errText}`);
  }
}

// ============================================
// GENERATE REPLY COM PERSONA (Phase 3 v8) — Claude Haiku
// Hipótese: Claude segue instrução de persona/voz melhor que GPT em PT-BR
// Mantém multi-turn few-shot (system + exemplos como assistant turns)
// API: Anthropic Messages API (não OpenAI)
// ============================================
async function generateReply(user, context) {
  const persona = user?.persona || 'ceo';
  const memoName = user?.memo_name || 'Memo';
  const userName = user?.user_display_name || 'senhor';
  const basePrompt = PERSONA_SYSTEM[persona] || PERSONA_SYSTEM.ceo;
  let systemPrompt = basePrompt
    .replace(/\{MEMO_NAME\}/g, memoName)
    .replace(/\{USER_NAME\}/g, userName);
  const personaExamples = PERSONA_FEWSHOT[persona] || PERSONA_FEWSHOT.ceo;
  let antiRepInstructions = '';

  // Monta array de messages (user/assistant turns — system vai separado no Claude)
  const messages = [];

  if (context.isWelcome) {
    // Welcome: injeta exemplos de boas-vindas como turns anteriores
    const welcomeExamples = personaExamples.welcome || [];
    for (const ex of welcomeExamples) {
      messages.push({ role: 'user', content: 'O usuário acabou de me escolher. Primeira fala.' });
      messages.push({ role: 'assistant', content: ex.output.replace(/\{USER_NAME\}/g, userName) });
    }
    messages.push({ role: 'user', content: `O usuário se chama ${userName}. Gere saudação IGUAL ao tom das anteriores. Use o nome dele OU "senhor". Máximo 7 palavras. PROIBIDO: perguntas, "o que deseja", "como posso", "à disposição", "à escuta", "pronto para anotações", "aguardo", "pode começar", "pode iniciar", .` });
  } else {
    // Confirmação: few-shot multi-turn com exemplos da categoria
    const { category, metadata, originalText } = context;
    const person = metadata?.person || null;
    const dateText = metadata?.date_text || null;
    const timeText = metadata?.time_text || null;

    // Injeta exemplos como conversa real (user → assistant)
    const examples = selectFewShot(persona, category);
    for (const ex of examples) {
      messages.push({ role: 'user', content: ex.input });
      messages.push({ role: 'assistant', content: ex.output.replace(/\{USER_NAME\}/g, userName) });
    }

    // Mensagem real do usuário — SÓ o texto + metadata de contexto (sem destino — fechamento é post-processing)
    const realMessage = `${originalText}${person ? ` [pessoa: ${person}]` : ''}${dateText ? ` [data: ${dateText}]` : ''}${timeText ? ` [hora: ${timeText}]` : ''}`;
    messages.push({ role: 'user', content: realMessage });

    // Anti-repetição vai como mensagem de sistema separada (não na msg do usuário)
    const recentReplies = context.recentReplies || [];
    if (recentReplies.length > 0) {
      antiRepInstructions = `\nVarie sua resposta. NÃO repita estas frases que você já usou recentemente: ${recentReplies.map(r => `"${r}"`).join(', ')}`;
    }

  }

  // Injeta anti-repetição no system prompt (não na mensagem do usuário)
  const finalSystemPrompt = systemPrompt + antiRepInstructions;

  // Claude Messages API — system prompt vai como campo separado
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      system: finalSystemPrompt,
      messages,
      max_tokens: 150,
      temperature: 0.75
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`generateReply Claude failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text?.trim();
  if (!text) throw new Error('generateReply: empty response');
  return text;
}

// ============================================
// ENVIAR RESPOSTA VIA WHATSAPP — inalterado
// ============================================
async function sendWhatsAppReply(to, text) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        text: { body: text }
      })
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${errText}`);
  }
}
